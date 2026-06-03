// Regression suite for the github-timing-safe-equal predicate (backs the critical rules
// github/missing-timing-safe-equal + github/timing-unsafe-comparison).
//
// THE BUG THIS LOCKS DOWN: the predicate used to return "verified" on the safe path. Because the
// engine builds a Finding for ANY non-null verdict and stamps it with the rule's fixed `critical`
// severity + "verification missing" message, a textbook-correct hand-rolled GitHub handler
// (crypto.createHmac + crypto.timingSafeEqual) surfaced TWO false-positive criticals and failed the
// build — a direct hit to the <5% false-positive correctness moat. The safe path must return `null`
// (no finding); the positive signal belongs to the info-severity github/library-verified rule.
//
// Negative tests are SOC2 auditor-facing evidence ([[feedback_negative_tests_required]]).

import type { ProjectModel, ReachableSymbol, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { githubTimingSafeEqualPredicate } from "../src/predicates/github-timing-safe-equal.js";

const sym = (qualified_name: string, import_source: string | null = null): ReachableSymbol => ({
  qualified_name,
  import_source,
  hops: 1,
  via: "direct call",
});

function githubHandler(reachable_symbols: ReachableSymbol[]): WebhookHandler {
  return {
    id: "h",
    framework: "express",
    framework_version: null,
    route_pattern: "/webhooks/github",
    http_methods: ["POST"],
    file_path: "src/webhook.js",
    location: { line: 5, col: 1, end_line: 18, end_col: 1 },
    handler_function_name: "githubHook",
    provider: "github",
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols,
    findings_ref: [],
    redacted_snippet: "",
  };
}

// Path A (JS/Python) reaches reachable_symbols only; an empty model is sufficient.
const emptyModel = { parsed_files: [] } as unknown as ProjectModel;

describe("githubTimingSafeEqualPredicate — safe paths return null (no false-positive critical)", () => {
  it("hand-rolled handler reaching crypto.timingSafeEqual → null (the regression)", async () => {
    const handler = githubHandler([sym("crypto.createHmac"), sym("crypto.timingSafeEqual")]);
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBeNull();
  });

  it("node:crypto-imported timingSafeEqual (`.timingSafeEqual` suffix) → null", async () => {
    const handler = githubHandler([sym("node:crypto.timingSafeEqual")]);
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBeNull();
  });

  it("@octokit/webhooks SDK verifier reachable → null", async () => {
    const handler = githubHandler([sym("verify", "@octokit/webhooks")]);
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBeNull();
  });

  it("@octokit/webhooks-methods verifier reachable → null", async () => {
    const handler = githubHandler([sym("verify", "@octokit/webhooks-methods")]);
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBeNull();
  });
});

describe("githubTimingSafeEqualPredicate — unsafe path still fires (fix did not over-suppress)", () => {
  it("github handler reaching NEITHER timingSafeEqual NOR the SDK → not-verified", async () => {
    const handler = githubHandler([sym("crypto.createHmac")]); // HMAC computed, no constant-time compare
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBe("not-verified");
  });

  it("github handler with zero reachable symbols → not-verified", async () => {
    const handler = githubHandler([]);
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBe("not-verified");
  });
});

describe("githubTimingSafeEqualPredicate — applicability", () => {
  it("non-github handler → null (rule does not apply)", async () => {
    const handler = { ...githubHandler([]), provider: "stripe" };
    await expect(githubTimingSafeEqualPredicate(handler, emptyModel)).resolves.toBeNull();
  });
});
