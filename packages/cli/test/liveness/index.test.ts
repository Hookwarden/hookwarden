// Phase 28 LEAK-06 — liveness dispatch (SC#3 signing-secret-never-probed +
// secret-class routing + redaction).

import { describe, expect, it, vi } from "vitest";
import {
  classifySecret,
  extractCredential,
  probeLiveness,
  sanitiseProbeError,
} from "../../src/liveness/index.js";
import type { ProbeFetch } from "../../src/liveness/verdict.js";

describe("classifySecret", () => {
  it("classifies prefixes into the right secret class", () => {
    expect(classifySecret("whsec_abc").kind).toBe("signing-secret");
    expect(classifySecret("rk_live_abc").kind).toBe("stripe-key");
    expect(classifySecret("sk_live_abc").kind).toBe("stripe-key");
    expect(classifySecret("ghs_abc").kind).toBe("github-token");
    expect(classifySecret("github_pat_abc").kind).toBe("github-token");
    expect(classifySecret("n8n_api_abc").kind).toBe("unknown");
  });
});

describe("probeLiveness dispatch", () => {
  it("SC#3: a whsec_ signing secret → unverified and NEVER calls the provider", async () => {
    const spy = vi.fn<ProbeFetch>(async () => ({ status: 200 }));
    expect(await probeLiveness("whsec_secret", { fetch: spy })).toBe("unverified");
    expect(spy).not.toHaveBeenCalled();
  });

  it("an unknown-class secret → unverified with NO provider call", async () => {
    const spy = vi.fn<ProbeFetch>(async () => ({ status: 200 }));
    expect(await probeLiveness("n8n_api_token", { fetch: spy })).toBe("unverified");
    expect(spy).not.toHaveBeenCalled();
  });

  it("dispatches a Stripe key to the Stripe probe (403 → live)", async () => {
    const spy = vi.fn<ProbeFetch>(async (url) => {
      expect(url).toContain("api.stripe.com");
      return { status: 403 };
    });
    expect(await probeLiveness("rk_live_x", { fetch: spy })).toBe("live");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dispatches a GitHub token to the GitHub probe (200 → live)", async () => {
    const spy = vi.fn<ProbeFetch>(async (url) => {
      expect(url).toContain("api.github.com");
      return { status: 200 };
    });
    expect(await probeLiveness("github_pat_x", { fetch: spy })).toBe("live");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("extractCredential", () => {
  const source = [
    "import express from 'express';",
    "const app = express();",
    "app.post('/webhooks/gh', (req, res) => {",
    "  const token = 'github_pat_11ABCDEF_secretbody123';",
    "  res.send('ok');",
    "});",
  ].join("\n");

  it("recovers the full prefix+value run from the handler region", () => {
    const raw = extractCredential(source, { line: 3, endLine: 6 }, ["github_pat_", "ghs_"]);
    expect(raw).toBe("github_pat_11ABCDEF_secretbody123");
  });

  it("returns null when no catalog prefix is present in the region", () => {
    expect(extractCredential(source, { line: 1, endLine: 2 }, ["whsec_"])).toBeNull();
  });
});

describe("sanitiseProbeError", () => {
  it("redacts rk_/sk_/whsec_/gh* fragments to [REDACTED]", () => {
    const msg = sanitiseProbeError(new Error("bad rk_live_abc123 / whsec_def456 / ghs_ghi789"));
    expect(msg).not.toContain("rk_live_abc123");
    expect(msg).not.toContain("whsec_def456");
    expect(msg).not.toContain("ghs_ghi789");
    expect(msg).toContain("[REDACTED]");
  });
});
