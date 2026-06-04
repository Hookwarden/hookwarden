// Phase 28 LEAK-06 — entitlement preflight for `--verify-secrets` (public CLI).
//
// Before ANY provider probe, the CLI consults the SaaS entitlement route with a
// workspace bearer token ONLY (D-09 / Pitfall 4). The body carries nothing but
// `{ feature: "verify_secrets" }` — never a secret, never a finding, never repo
// data (T-28-04-01). The plan/tier is resolved SERVER-SIDE (28-03); the CLI does
// NOT re-encode tier rules.
//
// Fail-closed: a missing token, a non-200 (402 upgrade_required), or a network
// error all DENY — `--verify-secrets` then makes ZERO provider calls.
//
// Transport: Node 22 global `fetch` (a runtime global, not an import) so the
// bundle-inspection gate never sees an HTTP-client specifier.

const TOKEN_ENV = "HOOKWARDEN_TOKEN";
const API_URL_ENV = "HOOKWARDEN_API_URL";
const DEFAULT_API_BASE = "https://hookwarden.dev";

export type EntitlementFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; ok: boolean }>;

export interface EntitlementDeps {
  /** Defaults to process.env.HOOKWARDEN_TOKEN. */
  token?: string | undefined;
  /** Defaults to process.env.HOOKWARDEN_API_URL || https://hookwarden.dev. */
  apiBase?: string | undefined;
  /** Defaults to a thin wrapper over global fetch. */
  fetch?: EntitlementFetch;
}

export type DenyReason = "missing_token" | "denied" | "unreachable";

export type EntitlementResult = { allowed: true } | { allowed: false; reason: DenyReason };

const defaultEntitlementFetch: EntitlementFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok };
};

/**
 * Resolve whether `--verify-secrets` is entitled. Token-only; fail-closed on
 * every error path. NEVER transmits a secret.
 */
export async function checkVerifyEntitlement(
  deps: EntitlementDeps = {},
): Promise<EntitlementResult> {
  const token = deps.token ?? process.env[TOKEN_ENV];
  if (token === undefined || token.trim() === "") {
    return { allowed: false, reason: "missing_token" };
  }
  const apiBase = deps.apiBase ?? process.env[API_URL_ENV] ?? DEFAULT_API_BASE;
  const doFetch = deps.fetch ?? defaultEntitlementFetch;
  try {
    const res = await doFetch(`${apiBase}/api/cli/entitlement`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      // Token-only contract — the body is EXACTLY this, never a secret.
      body: JSON.stringify({ feature: "verify_secrets" }),
    });
    if (res.status === 200 && res.ok) {
      return { allowed: true };
    }
    return { allowed: false, reason: "denied" }; // 402 upgrade_required / any non-200
  } catch {
    return { allowed: false, reason: "unreachable" }; // fail closed
  }
}

/**
 * User-facing copy for a denied / mis-configured `--verify-secrets`. Names the
 * env var + the dashboard mint flow + the paid-tier nature (user-readable per
 * MEMORY feedback_cli_output_user_readable). Returned as a string so the caller
 * writes it to the right stream.
 */
export function upsellMessage(reason: DenyReason): string {
  const lines: string[] = [];
  if (reason === "missing_token") {
    lines.push("--verify-secrets needs a hookwarden workspace token.");
    lines.push(`  Set ${TOKEN_ENV} to a token minted from the dashboard (Settings → CLI tokens):`);
    lines.push(`    ${TOKEN_ENV}=hw_… hookwarden scan --verify-secrets`);
  } else if (reason === "unreachable") {
    lines.push("--verify-secrets could not reach hookwarden to check entitlement; skipped.");
    lines.push("  Findings are reported as 'unverified'. Check your network / HOOKWARDEN_API_URL.");
  } else {
    lines.push(
      "--verify-secrets is a paid (team) feature — live verification is not on your plan.",
    );
    lines.push("  Mint a token from the dashboard (Settings → CLI tokens) on a team workspace,");
    lines.push(
      `  then set ${TOKEN_ENV} and re-run. Findings are reported as 'unverified' for now.`,
    );
  }
  return lines.join("\n");
}
