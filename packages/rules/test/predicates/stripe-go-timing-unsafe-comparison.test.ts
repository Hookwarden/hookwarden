// Phase 27 (RULES-GO-01) — Success Criterion #1 (predicate half). Asserts the PREDICATE RESULT
// (null | "not-verified"), NEVER the pipeline STATE. The `verified` state for an SDK handler is a
// separate pipeline assertion (27-05 CLI round-trip) — a critical predicate can never return
// "verified" (MEMORY project_critical_rule_safe_path_must_return_null).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  type GoRuntime,
  initGoRuntime,
  type ParsedFile,
  type ProjectModel,
  parseGo,
  type WebhookEvidence,
  type WebhookHandler,
} from "@hookwarden/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { stripeGoTimingUnsafeComparisonPredicate } from "../../src/predicates/stripe-go-timing-unsafe-comparison.js";

const require = createRequire(import.meta.url);
function resolveGoWasmPath(): string {
  const pkgPath = require.resolve("tree-sitter-go/package.json");
  return join(dirname(pkgPath), "tree-sitter-go.wasm");
}

let runtime: GoRuntime;
beforeAll(async () => {
  runtime = await initGoRuntime({ wasmBytes: new Uint8Array(readFileSync(resolveGoWasmPath())) });
}, 30_000);

const parse = (src: string): Promise<ParsedFile> =>
  parseGo({ file_path: "webhooks/stripe.go", source_text: src }, runtime);

function handler(
  file: ParsedFile,
  provider = "stripe",
  evidence: WebhookEvidence[] = [],
): WebhookHandler {
  return {
    id: "h1",
    framework: "net-http-go",
    framework_version: null,
    route_pattern: "/webhooks/stripe",
    http_methods: ["POST"],
    file_path: file.file_path,
    location: { line: 1, col: 1, end_line: 1, end_col: 1 },
    handler_function_name: null,
    provider,
    verification_state: "manual-review",
    evidence,
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
  };
}
const model = (file: ParsedFile): ProjectModel =>
  ({
    parsed_files: [file],
    handlers: [],
    middleware_registrations: [],
    import_graph: [],
  }) as ProjectModel;

const HMAC_PRELUDE = "\tmac := hmac.New(sha256.New, key)\n\tmac.Write(body)\n";

describe("stripeGoTimingUnsafeComparison — SC#1 predicate half", () => {
  it("bytes.Equal(mac, sig) → not-verified (the CWE-208 bug)", async () => {
    const f = await parse(
      `package webhooks\nfunc H(w http.ResponseWriter, r *http.Request) {\n${HMAC_PRELUDE}\tif bytes.Equal(mac.Sum(nil), sig) {\n\t}\n}\n`,
    );
    expect(await stripeGoTimingUnsafeComparisonPredicate(handler(f), model(f))).toBe(
      "not-verified",
    );
  });

  it("hand-rolled hmac.Equal(mac, sig) → null (safe path; NOT 'verified')", async () => {
    const f = await parse(
      `package webhooks\nfunc H(w http.ResponseWriter, r *http.Request) {\n${HMAC_PRELUDE}\tif hmac.Equal(mac.Sum(nil), sig) {\n\t}\n}\n`,
    );
    const result = await stripeGoTimingUnsafeComparisonPredicate(handler(f), model(f));
    expect(result).toBeNull(); // explicitly NOT "verified"
  });

  it("string(mac) == sig → not-verified", async () => {
    const f = await parse(
      `package webhooks\nfunc H(w http.ResponseWriter, r *http.Request) {\n${HMAC_PRELUDE}\tif string(mac.Sum(nil)) == sig {\n\t}\n}\n`,
    );
    expect(await stripeGoTimingUnsafeComparisonPredicate(handler(f), model(f))).toBe(
      "not-verified",
    );
  });

  it("SDK-verified handler (sdk_verify_call evidence) → null (SDK exemption)", async () => {
    const f = await parse(
      `package webhooks\nfunc H(w http.ResponseWriter, r *http.Request) {\n\t_, _ = webhook.ConstructEvent(body, sig, secret)\n}\n`,
    );
    const ev: WebhookEvidence[] = [
      {
        kind: "sdk_verify_call",
        provider: "stripe",
        location: { line: 1, col: 1, end_line: 1, end_col: 1 },
        detail: "webhook.ConstructEvent",
      },
    ];
    expect(
      await stripeGoTimingUnsafeComparisonPredicate(handler(f, "stripe", ev), model(f)),
    ).toBeNull();
  });

  it("provider mismatch → null", async () => {
    const f = await parse(
      `package webhooks\nfunc H(w http.ResponseWriter, r *http.Request) {\n${HMAC_PRELUDE}\tif bytes.Equal(mac.Sum(nil), sig) {\n\t}\n}\n`,
    );
    expect(
      await stripeGoTimingUnsafeComparisonPredicate(handler(f, "github"), model(f)),
    ).toBeNull();
  });

  it("parse error → null (no crash)", async () => {
    const f = await parse("package webhooks\nfunc H( {\n");
    expect(await stripeGoTimingUnsafeComparisonPredicate(handler(f), model(f))).toBeNull();
  });
});
