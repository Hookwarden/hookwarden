// Phase 28 LEAK-06 — GitHub token liveness probe.

import { describe, expect, it, vi } from "vitest";
import { probeGithubToken } from "../../src/liveness/github.js";
import type { ProbeFetch } from "../../src/liveness/verdict.js";

const fetchStatus = (status: number): ProbeFetch => vi.fn(async () => ({ status }));

describe("probeGithubToken", () => {
  it("200 → live", async () => {
    expect(await probeGithubToken("github_pat_x", fetchStatus(200))).toBe("live");
  });
  it("401 → dead", async () => {
    expect(await probeGithubToken("ghs_x", fetchStatus(401))).toBe("dead");
  });
  it("403 → unverified (rate-limit / SSO — inconclusive)", async () => {
    expect(await probeGithubToken("ghs_x", fetchStatus(403))).toBe("unverified");
  });
  it("other status → unverified", async () => {
    expect(await probeGithubToken("ghs_x", fetchStatus(500))).toBe("unverified");
  });
  it("a network throw → unverified", async () => {
    const throwing: ProbeFetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    expect(await probeGithubToken("ghs_x", throwing)).toBe("unverified");
  });
});
