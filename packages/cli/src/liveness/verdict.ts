// Phase 28 LEAK-06 — liveness verdict type + the verdict→severity/exit remap.
//
// A leaked credential's liveness is a FACET on a LEAK finding:
//   live       — the credential authenticated against its provider just now. The
//                worst case for a leak → escalate to `critical` so --fail-on gates.
//   dead       — the credential was rejected (revoked/rotated) → downgrade to
//                `info`; an already-dead leak must NEVER emit a false critical.
//   unverified — could not determine (signing secret, no entitlement, network,
//                non-Stripe/GitHub provider) → keep the finding's current severity.
//
// This mirrors severity-threshold.ts's safe-state-never-gates philosophy and the
// MEMORY lesson "critical-rule predicates return null on the safe path": only a
// confirmed `live` escalates. Because `countActiveAtOrAbove` already drives
// --fail-on, downgrading dead→info removes it from the gate and escalating
// live→critical includes it — NO special-case in the exit-code path (D-07/D-08).

import type { Finding } from "@hookwarden/engine";

export type Liveness = "live" | "dead" | "unverified";

/** Minimal response surface the probes read — just the status code. */
export interface ProbeResponse {
  readonly status: number;
}

/**
 * Injectable transport. In production this wraps Node 22 global `fetch`; tests
 * pass a stub. Typed narrowly (not the full `fetch`) so the probes stay a thin,
 * mockable seam and the bundle gate never sees an HTTP-client import.
 */
export type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<ProbeResponse>;

/**
 * Attach the liveness verdict to `metadata.liveness` and remap severity per the
 * FP moat. Additive — `metadata` is an open record, no engine type change.
 */
export function remapForLiveness(f: Finding, v: Liveness): Finding {
  const metadata = { ...f.metadata, liveness: v };
  switch (v) {
    case "live":
      return { ...f, severity: "critical", metadata };
    case "dead":
      return { ...f, severity: "info", metadata };
    case "unverified":
      return { ...f, metadata };
  }
}
