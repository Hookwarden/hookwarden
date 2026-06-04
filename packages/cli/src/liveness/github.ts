// Phase 28 LEAK-06 — GitHub token liveness probe (public CLI, Apache-2.0).
//
// A ~30-line stateless read-only probe via Node 22 global `fetch` (no import of
// the private octokit-app-auth adapter). The leaked token is in-memory only.
//
// Status classification:
//   200 → live ; 401 → dead ; 403 (rate-limit / SSO) → unverified ; other/5xx →
//   unverified (inconclusive — never a false dead).

import type { Liveness, ProbeFetch } from "./verdict.js";

export async function probeGithubToken(
  leakedToken: string,
  doFetch: ProbeFetch,
): Promise<Liveness> {
  try {
    const res = await doFetch("https://api.github.com/user", {
      method: "GET",
      headers: { authorization: `Bearer ${leakedToken}`, "user-agent": "hookwarden" },
    });
    if (res.status === 200) return "live";
    if (res.status === 401) return "dead";
    return "unverified"; // 403 / other / 5xx — inconclusive
  } catch {
    return "unverified";
  }
}
