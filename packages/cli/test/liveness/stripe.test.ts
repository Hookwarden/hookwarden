// Phase 28 LEAK-06 — Stripe liveness probe (Pitfall 3: 403 → live, not dead).

import { describe, expect, it, vi } from "vitest";
import { probeStripeKey } from "../../src/liveness/stripe.js";
import type { ProbeFetch } from "../../src/liveness/verdict.js";

const fetchStatus = (status: number): ProbeFetch => vi.fn(async () => ({ status }));

describe("probeStripeKey", () => {
  it("200 → live", async () => {
    expect(await probeStripeKey("rk_live_x", fetchStatus(200))).toBe("live");
  });
  it("401 → dead", async () => {
    expect(await probeStripeKey("rk_live_x", fetchStatus(401))).toBe("dead");
  });
  it("403 → live (authenticated but unscoped — NOT dead)", async () => {
    expect(await probeStripeKey("sk_live_x", fetchStatus(403))).toBe("live");
  });
  it("5xx → unverified", async () => {
    expect(await probeStripeKey("rk_live_x", fetchStatus(503))).toBe("unverified");
  });
  it("a network throw → unverified (never crashes, never false-dead)", async () => {
    const throwing: ProbeFetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await probeStripeKey("rk_live_x", throwing)).toBe("unverified");
  });
});
