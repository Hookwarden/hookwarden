// Phase 28 LEAK-06 — Stripe API-key liveness probe (public CLI, Apache-2.0).
//
// A ~30-line stateless read-only probe. Copies the CALL SHAPE of the private
// rotation adapter's restricted-key probe (webhookEndpoints.list) but via Node
// 22 global `fetch` — it does NOT import the private adapter (which carries
// KMS/Drizzle/state-machine baggage forbidden by the engine/CLI boundary). The
// leaked key is held in-memory only; every error path is redacted (D-04/V7).
//
// Status classification (Pitfall 3):
//   200 → live ; 401 → dead ; 403 → live (the key AUTHENTICATED but lacks scope —
//   it is NOT revoked, which is the worst case for a leak) ; network/5xx →
//   unverified (never crash, never a false dead).

import type { Liveness, ProbeFetch } from "./verdict.js";

export async function probeStripeKey(leakedKey: string, doFetch: ProbeFetch): Promise<Liveness> {
  try {
    const res = await doFetch("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: { authorization: `Bearer ${leakedKey}` },
    });
    if (res.status === 200) return "live";
    if (res.status === 401) return "dead";
    if (res.status === 403) return "live"; // authenticated but unscoped — NOT dead
    return "unverified"; // 5xx / unexpected
  } catch {
    return "unverified"; // network failure — never crash, never false-dead
  }
}
