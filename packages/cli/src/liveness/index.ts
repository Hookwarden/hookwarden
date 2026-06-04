// Phase 28 LEAK-06 — liveness dispatch (public CLI, Apache-2.0).
//
// Classifies a leaked credential by prefix and routes it to the right read-only
// provider probe — or returns `unverified` WITHOUT any network call when the
// secret is not a probeable API key:
//   * signing-secret-class (`whsec_`, GitHub webhook secret) → ALWAYS unverified,
//     NO fetch (SC#3 — no provider authenticates with a signing secret).
//   * Stripe api-key (`rk_`/`sk_`) → Stripe probe.
//   * GitHub token (`ghs_`/`github_pat_`/`gho_`/`ghu_`/`ghr_`/`ghp_`) → GitHub probe.
//   * anything else (n8n, anthropic, unknown) → unverified, NO fetch.
//
// The leaked secret is held in-memory only and never written to disk/state/logs
// (D-04). The dispatch imports NO private rotation/integrations/api package — it
// is a minimal OSS reimplementation that copies only the call shapes.

import { probeGithubToken } from "./github.js";
import { probeStripeKey } from "./stripe.js";
import type { Liveness, ProbeFetch, ProbeResponse } from "./verdict.js";

export type { Liveness, ProbeFetch } from "./verdict.js";

// Production transport: a thin wrapper over Node 22 global `fetch` (a runtime
// global, NOT an import — the bundle gate never sees an HTTP-client specifier).
export const defaultProbeFetch: ProbeFetch = async (url, init): Promise<ProbeResponse> => {
  const res = await fetch(url, init);
  return { status: res.status };
};

const SIGNING_SECRET_PREFIXES: ReadonlyArray<string> = ["whsec_"];
const STRIPE_API_KEY_PREFIXES: ReadonlyArray<string> = ["rk_", "sk_"];
const GITHUB_TOKEN_PREFIXES: ReadonlyArray<string> = [
  "ghs_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghr_",
  "github_pat_",
];

type SecretClass =
  | { kind: "signing-secret" }
  | { kind: "stripe-key" }
  | { kind: "github-token" }
  | { kind: "unknown" };

/** Classify a leaked credential by its prefix (the secret-class model). */
export function classifySecret(rawValue: string): SecretClass {
  if (SIGNING_SECRET_PREFIXES.some((p) => rawValue.startsWith(p))) {
    return { kind: "signing-secret" };
  }
  if (STRIPE_API_KEY_PREFIXES.some((p) => rawValue.startsWith(p))) {
    return { kind: "stripe-key" };
  }
  if (GITHUB_TOKEN_PREFIXES.some((p) => rawValue.startsWith(p))) {
    return { kind: "github-token" };
  }
  return { kind: "unknown" };
}

export interface ProbeDeps {
  fetch?: ProbeFetch;
}

/**
 * Probe a leaked credential's liveness. A signing-secret / unknown-class value
 * returns `unverified` WITHOUT any provider call; only an api-key-class value
 * reaches a probe. `rawValue` is in-memory only and never logged.
 */
export async function probeLiveness(rawValue: string, deps: ProbeDeps = {}): Promise<Liveness> {
  const cls = classifySecret(rawValue);
  if (cls.kind === "signing-secret" || cls.kind === "unknown") {
    return "unverified"; // SC#3 / non-probeable provider — no fetch
  }
  const doFetch = deps.fetch ?? defaultProbeFetch;
  if (cls.kind === "stripe-key") return probeStripeKey(rawValue, doFetch);
  return probeGithubToken(rawValue, doFetch);
}

// The token-character run a leaked credential spans after its prefix. Mirrors
// the leak-scanner's body class (base64 / base64url material).
const CREDENTIAL_BODY = /[A-Za-z0-9+/=_-]+/;

/**
 * Recover the RAW leaked credential from the source region a LEAK finding points
 * at. The finding's `location` spans the HANDLER (not the literal), and the
 * snippet is redacted — so to probe, the CLI re-reads the user's own source and
 * scans the handler region for one of the provider's catalog prefixes, returning
 * the full `prefix + value` run. Returns null when no prefix is found. The value
 * is the caller's to hold in-memory only (D-04).
 */
export function extractCredential(
  sourceText: string,
  region: { line: number; endLine: number },
  prefixes: ReadonlyArray<string>,
): string | null {
  const lines = sourceText.split(/\r?\n/);
  // location is 1-indexed and end_line inclusive.
  const slice = lines.slice(Math.max(0, region.line - 1), region.endLine).join("\n");
  for (const prefix of prefixes) {
    if (prefix.length === 0) continue;
    const at = slice.indexOf(prefix);
    if (at < 0) continue;
    CREDENTIAL_BODY.lastIndex = 0;
    const bodyMatch = CREDENTIAL_BODY.exec(slice.slice(at + prefix.length));
    const body = bodyMatch !== null && bodyMatch.index === 0 ? bodyMatch[0] : "";
    return prefix + body;
  }
  return null;
}

/**
 * Strip any provider key fragment from a string before it can reach output.
 * Mirrors the private rotation adapter's `sanitiseProbeError` (V7 / D-04).
 */
export function sanitiseProbeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(
    /\b(rk|sk|whsec|ghs|ghp|gho|ghu|ghr|github_pat)_[A-Za-z0-9_]+/g,
    "[REDACTED]",
  );
  return stripped.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}
