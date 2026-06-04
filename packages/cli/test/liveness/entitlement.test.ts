// Phase 28 LEAK-06 — entitlement preflight: token-only, fail-closed, deny-no-probe.

import { describe, expect, it, vi } from "vitest";
import {
  checkVerifyEntitlement,
  type EntitlementFetch,
  upsellMessage,
} from "../../src/liveness/entitlement.js";

const okFetch = (status: number): EntitlementFetch =>
  vi.fn(async () => ({ status, ok: status >= 200 && status < 300 }));

describe("checkVerifyEntitlement", () => {
  it("a valid token + 200 → allowed", async () => {
    const res = await checkVerifyEntitlement({ token: "hw_test", fetch: okFetch(200) });
    expect(res).toEqual({ allowed: true });
  });

  it("402 → denied (fail closed)", async () => {
    const res = await checkVerifyEntitlement({ token: "hw_test", fetch: okFetch(402) });
    expect(res).toEqual({ allowed: false, reason: "denied" });
  });

  it("missing token → missing_token, with NO network call", async () => {
    const spy = vi.fn<EntitlementFetch>(async () => ({ status: 200, ok: true }));
    const res = await checkVerifyEntitlement({ token: "", fetch: spy });
    expect(res).toEqual({ allowed: false, reason: "missing_token" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a network error → unreachable (fail closed)", async () => {
    const throwing: EntitlementFetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const res = await checkVerifyEntitlement({ token: "hw_test", fetch: throwing });
    expect(res).toEqual({ allowed: false, reason: "unreachable" });
  });

  it("transmits ONLY {feature:verify_secrets} — no secret in the body", async () => {
    let capturedBody = "";
    const spy: EntitlementFetch = vi.fn(async (_url, init) => {
      capturedBody = init.body;
      return { status: 200, ok: true };
    });
    await checkVerifyEntitlement({ token: "hw_test", fetch: spy });
    expect(JSON.parse(capturedBody)).toEqual({ feature: "verify_secrets" });
    for (const frag of ["whsec_", "rk_", "sk_", "ghs_", "github_pat_"]) {
      expect(capturedBody).not.toContain(frag);
    }
  });
});

describe("upsellMessage", () => {
  it("names HOOKWARDEN_TOKEN + the dashboard mint flow on a missing token", () => {
    const msg = upsellMessage("missing_token");
    expect(msg).toContain("HOOKWARDEN_TOKEN");
    expect(msg.toLowerCase()).toContain("dashboard");
  });
  it("explains the paid-tier nature on a denial", () => {
    const msg = upsellMessage("denied");
    expect(msg.toLowerCase()).toContain("team");
    expect(msg).toContain("HOOKWARDEN_TOKEN");
  });
});
