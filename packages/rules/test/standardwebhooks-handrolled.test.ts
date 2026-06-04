// 08.3 Plan 16b — Standard Webhooks HAND-ROLLED prong tests (the Clerk CVE-2025-53548 catch).
//
// Sibling to standardwebhooks.test.ts (the Plan 16 library-prong suite — NOT edited here, per
// 16-SUMMARY deviation #3). Covers the three-way split in custom/standardwebhooks-signing.ts
// (not-verified / manual-review / null) across JS/TS + Python + PHP, the net-new
// multi-signature-mishandled predicate, and the mandatory negative/near-miss + whsec_ guards.
// Negative tests are SOC2 auditor-facing evidence ([[feedback_negative_tests_required]]).

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initPhpRuntime,
  type ParsedFile,
  parseJsTs,
  type PhpRuntime,
  type ProjectModel,
  parsePhp,
  type ReachableSymbol,
  type WebhookHandler,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { standardwebhooksSigningPredicate } from "../src/predicates/custom/standardwebhooks-signing.js";
import { standardwebhooksMultiSignatureRotationMishandledPredicate } from "../src/predicates/standardwebhooks-multi-signature.js";

const baseHandler: WebhookHandler = {
  id: "h",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 1, col: 1, end_line: 2, end_col: 1 },
  handler_function_name: "webhookHandler",
  provider: "standardwebhooks",
  verification_state: "manual-review",
  evidence: [],
  middleware_chain: [],
  reachable_symbols: [],
  findings_ref: [],
  redacted_snippet: "",
};

const sym = (qualified_name: string, import_source: string | null = null): ReachableSymbol => ({
  qualified_name,
  import_source,
  hops: 1,
  via: "direct call",
});

// ── PHP runtime + helpers ────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
function resolvePhpWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-php/package.json");
  return join(dirname(pkgPath), "tree-sitter-php.wasm");
}

let phpRuntime: PhpRuntime;
beforeAll(async () => {
  phpRuntime = await initPhpRuntime({
    wasmBytes: new Uint8Array(readFileSync(resolvePhpWasmPath())),
  });
}, 30_000);

async function phpModelAndHandler(
  source: string,
): Promise<{ model: ProjectModel; handler: WebhookHandler }> {
  const filePath = "app/Http/Controllers/WebhookController.php";
  const file: ParsedFile = await parsePhp({ file_path: filePath, source_text: source }, phpRuntime);
  const model = { parsed_files: [file] } as unknown as ProjectModel;
  const handler: WebhookHandler = {
    ...baseHandler,
    framework: "laravel",
    file_path: filePath,
    reachable_symbols: [],
  };
  return { model, handler };
}

// JS/TS hand-rolled handlers parsed to a real babel AST, so the predicate's babel-walk defer
// path (hasInsecureSignatureComparisonJsTs) is actually exercised — synthetic reachable_symbols
// alone cannot, since a bare `!==` operator is not a reachable symbol.
async function jsModelAndHandler(
  source: string,
  reachable: ReadonlyArray<ReachableSymbol>,
): Promise<{ model: ProjectModel; handler: WebhookHandler }> {
  const filePath = "app/api/webhook/route.ts";
  const file: ParsedFile = await parseJsTs({ file_path: filePath, source_text: source });
  const model = { parsed_files: [file] } as unknown as ProjectModel;
  const handler: WebhookHandler = {
    ...baseHandler,
    framework: "nextjs",
    file_path: filePath,
    location: { line: 1, col: 1, end_line: 9999, end_col: 1 },
    reachable_symbols: [...reachable],
  };
  return { model, handler };
}

// Uses camelCase compound identifiers (webhookSignature / computedSignature) — dub's exact shape.
// These defeat a whole-word `\b...\b` regex, so this fixture guards the camelCase-aware matcher.
const JS_INSECURE_COMPARE = `import crypto from "crypto";
export const POST = async (req) => {
  const body = await req.json();
  const webhookSignature = req.headers.get("Webhook-Signature");
  const computedSignature = crypto.createHmac("sha256", process.env.SECRET).update(JSON.stringify(body)).digest("hex");
  if (webhookSignature !== computedSignature) { return new Response("bad", { status: 400 }); }
  return new Response("OK");
};`;

const JS_NO_COMPARE = `import crypto from "crypto";
export const POST = async (req) => {
  const body = await req.json();
  const computed = crypto.createHmac("sha256", process.env.SECRET).update(JSON.stringify(body)).digest("hex");
  console.log(computed);
  return new Response("OK");
};`;

const PHP_NO_COMPARE = `<?php
function handle($req, $secret) {
  $id = $req->header('webhook-id');
  $ts = $req->header('webhook-timestamp');
  $body = $req->getContent();
  $expected = hash_hmac('sha256', $id . '.' . $ts . '.' . $body, $secret);
  process($body);
}`;

const PHP_HASH_EQUALS = `<?php
function handle($req, $secret) {
  $id = $req->header('webhook-id');
  $ts = $req->header('webhook-timestamp');
  $body = $req->getContent();
  $expected = hash_hmac('sha256', $id . '.' . $ts . '.' . $body, $secret);
  $sig = $req->header('webhook-signature');
  if (hash_equals($expected, $sig)) { process($body); }
}`;

const PHP_INSECURE_COMPARE = `<?php
function handle($req, $secret) {
  $body = $req->getContent();
  $expected = hash_hmac('sha256', $body, $secret);
  $sig = $req->header('webhook-signature');
  if ($expected === $sig) { process($body); }
}`;

const PHP_UNRECOGNIZED_WRAPPER = `<?php
function handle($req, $secret) {
  $body = $req->getContent();
  $expected = hash_hmac('sha256', $body, $secret);
  $sig = $req->header('webhook-signature');
  if (verifySignature($expected, $sig)) { process($body); }
}`;

// ── POSITIVE: not-verified (CVE-2025-53548 catch) ────────────────────────────
describe("standardwebhooksSigningPredicate — hand-rolled not-verified (CVE-2025-53548)", () => {
  it("JS/TS: crypto.createHmac reachable, no comparison → not-verified", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("Python: hmac.new reachable, no comparison → not-verified", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "fastapi",
      file_path: "app/main.py",
      reachable_symbols: [sym("hmac.new")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBe("not-verified");
  });

  it("PHP: hash_hmac present, no hash_equals / insecure compare → not-verified", async () => {
    const { model, handler } = await phpModelAndHandler(PHP_NO_COMPARE);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBe("not-verified");
  });
});

// ── MANUAL-REVIEW: unrecognized local compare wrapper (the FP guard) ─────────
describe("standardwebhooksSigningPredicate — manual-review on undecidable local wrapper", () => {
  it("JS/TS: [crypto.createHmac, safeCompare] → manual-review, NOT not-verified", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("safeCompare")],
    };
    const verdict = await standardwebhooksSigningPredicate(handler, {} as never);
    expect(verdict).toBe("manual-review");
    expect(verdict).not.toBe("not-verified");
  });

  it("Python: [hmac.new, verifySig] (local verification wrapper) → manual-review", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "fastapi",
      file_path: "app/main.py",
      reachable_symbols: [sym("hmac.new"), sym("verifySig")],
    };
    const verdict = await standardwebhooksSigningPredicate(handler, {} as never);
    expect(verdict).toBe("manual-review");
    expect(verdict).not.toBe("not-verified");
  });

  it("PHP: hash_hmac + a local verifySignature() wrapper → manual-review", async () => {
    const { model, handler } = await phpModelAndHandler(PHP_UNRECOGNIZED_WRAPPER);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBe("manual-review");
  });
});

// ── NEGATIVE / NEAR-MISS: must NOT be a false not-verified ───────────────────
describe("standardwebhooksSigningPredicate — negative / near-miss (FP-moat evidence)", () => {
  it("JS/TS correctly-verified hand-rolled: [createHmac, timingSafeEqual] → null", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [
        sym("crypto.createHmac", "node:crypto"),
        sym("crypto.timingSafeEqual", "node:crypto"),
      ],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });

  it("Python correctly-verified hand-rolled: [hmac.new, hmac.compare_digest] → null", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      framework: "fastapi",
      file_path: "app/main.py",
      reachable_symbols: [sym("hmac.new"), sym("hmac.compare_digest")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });

  it("PHP correctly-verified hand-rolled: hash_hmac + hash_equals → null", async () => {
    const { model, handler } = await phpModelAndHandler(PHP_HASH_EQUALS);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBeNull();
  });

  it("PHP timing-unsafe hand-rolled: hash_hmac + (=== compare) → null (defers to timing-unsafe)", async () => {
    const { model, handler } = await phpModelAndHandler(PHP_INSECURE_COMPARE);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBeNull();
  });

  it("JS/TS timing-unsafe hand-rolled: createHmac + (sig !== computed) → null (defers, NOT a false missing-verification)", async () => {
    // The dub /api/dub/webhook FP: handler DOES verify (HMAC + `!==`), but the `!==` is an
    // operator, not a reachable symbol — pre-fix this hit the CVE branch and emitted a
    // contradictory missing-signature-verification critical alongside timing-unsafe-comparison.
    const { model, handler } = await jsModelAndHandler(JS_INSECURE_COMPARE, [
      sym("crypto.createHmac", "node:crypto"),
    ]);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBeNull();
  });

  it("JS/TS true CVE: createHmac but NO comparison anywhere → not-verified (no false negative from the fix)", async () => {
    const { model, handler } = await jsModelAndHandler(JS_NO_COMPARE, [
      sym("crypto.createHmac", "node:crypto"),
    ]);
    expect(await standardwebhooksSigningPredicate(handler, model)).toBe("not-verified");
  });

  it("library prong still wins: [Webhook.verify from standardwebhooks] → null (no regression)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("Webhook.verify", "standardwebhooks")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });

  it("cross-provider 2-part near-miss: Slack handler with [crypto.createHmac] → null (provider gate)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "slack",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBeNull();
  });

  it("non-HMAC-hash adversary: only [crypto.createHash] reachable → not-verified TERMINAL (no verification attempted, not the hand-rolled branch)", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHash", "node:crypto")],
    };
    // createHash is NOT a manual-HMAC entry → falls through to the terminal
    // no-verification-attempted path. Assert the explicit expected value (not a zero-match pass).
    expect(await standardwebhooksSigningPredicate(handler, {} as never)).toBe("not-verified");
  });
});

// ── MULTI-SIGNATURE rotation mishandled ──────────────────────────────────────
describe("standardwebhooksMultiSignatureRotationMishandledPredicate", () => {
  it("manual HMAC reachable + no iteration symbol → manual-review", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await standardwebhooksMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBe("manual-review");
  });

  it("iteration symbol reachable (signatures.split) → null", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      reachable_symbols: [sym("crypto.createHmac", "node:crypto"), sym("signatures.split")],
    };
    expect(
      await standardwebhooksMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });

  it("provider-scoped: stripe handler with [crypto.createHmac] → null", async () => {
    const handler: WebhookHandler = {
      ...baseHandler,
      provider: "stripe",
      reachable_symbols: [sym("crypto.createHmac", "node:crypto")],
    };
    expect(
      await standardwebhooksMultiSignatureRotationMishandledPredicate(handler, {} as never),
    ).toBeNull();
  });

  it("no manual HMAC reachable → null (missing-signature-verification owns that case)", async () => {
    expect(
      await standardwebhooksMultiSignatureRotationMishandledPredicate(baseHandler, {} as never),
    ).toBeNull();
  });
});

// ── WHSEC_ double-flag guard (SOC2-evidence negative) ────────────────────────
describe("whsec_ double-flag resolution — no standardwebhooks hardcoded-secret rule", () => {
  it("ships NO standardwebhooks/hardcoded-secret*.yaml (stripe rule already covers whsec_ provider-agnostically)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const swDir = join(here, "..", "rules", "standardwebhooks");
    const files = readdirSync(swDir);
    const hardcoded = files.filter((f) => /hardcoded-secret/i.test(f));
    expect(hardcoded).toEqual([]);
  });
});
