// Phase 27 (RULES-GO-01): Go reachability (collectCallsGo + buildSymbolTable Go branch) and the
// end-to-end Go sdk_verify_call evidence path (buildProjectModel). This is the engine home of the
// Go SDK-recognition integration assertions (Go parsing lives here, not in @hookwarden/rules) —
// mirrors how the PHP evidence integration lives in the engine, not in catalog-php.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { ALL_ADAPTERS } from "../../src/adapters/index.js";
import { buildProjectModel } from "../../src/model/build.js";
import { computeReachableSymbols } from "../../src/model/reachability.js";
import { type GoRuntime, initGoRuntime } from "../../src/parsers/go-loader.js";
import { parseGo } from "../../src/parsers/go.js";
import type { Config } from "../../src/types/config.js";
import type { ParsedFile } from "../../src/types/project-model.js";
import type { ProviderCatalog, ProviderCatalogEntry, RuleSet } from "../../src/types/rule-set.js";
import { resolveGoWasmPath } from "../wasm.js";

let runtime: GoRuntime;

beforeAll(async () => {
  runtime = await initGoRuntime({ wasmBytes: new Uint8Array(readFileSync(resolveGoWasmPath())) });
}, 30_000);

async function parse(file_path: string, source_text: string): Promise<ParsedFile> {
  return await parseGo({ file_path, source_text }, runtime);
}

interface GoNode {
  readonly type: string;
  childForFieldName(name: string): GoNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<GoNode>;
}

function namedFn(file: ParsedFile, name: string): unknown {
  const root = (file.raw_ast as { rootNode: GoNode }).rootNode;
  return root
    .descendantsOfType(["function_declaration", "method_declaration"])
    .find((fn) => fn.childForFieldName("name")?.type !== undefined && fnName(fn) === name);
}
function fnName(fn: GoNode): string | null {
  return fn.childForFieldName("name") ? (fn.childForFieldName("name") as unknown as { text: string }).text : null;
}
function firstFuncLiteral(file: ParsedFile): unknown {
  const root = (file.raw_ast as { rootNode: GoNode }).rootNode;
  return root.descendantsOfType(["func_literal"])[0];
}

// ---- minimal inline provider catalog (engine has no @hookwarden/rules dep) ----
function entry(p: Partial<ProviderCatalogEntry>): ProviderCatalogEntry {
  return {
    signature_header: [],
    sdk_packages: [],
    sdk_verify_calls: [],
    secret_env_prefix: [],
    secret_literal_prefix: [],
    conventional_paths: [],
    hmac_algorithm: "sha256",
    signing_input_format: "raw_body",
    timestamp_header: null,
    signature_encoding: "hex",
    applicable_rules: [],
    ...p,
  };
}
const CATALOG: ProviderCatalog = {
  stripe: entry({
    signature_header: ["stripe-signature"],
    sdk_packages: ["stripe", "github.com/stripe/stripe-go"],
    sdk_verify_calls: ["webhooks.constructEvent", "webhook.ConstructEvent"],
  }),
  github: entry({
    signature_header: ["x-hub-signature-256"],
    sdk_packages: ["@octokit/webhooks", "github.com/google/go-github"],
    sdk_verify_calls: ["verify", "github.ValidatePayload"],
  }),
  standardwebhooks: entry({
    signature_header: ["webhook-signature"],
    sdk_packages: ["github.com/svix/svix-webhooks/go"],
    sdk_verify_calls: ["Webhook.verify"],
  }),
};
const RULESET: RuleSet = {
  schema_version: 1,
  rule_pack_version: "test",
  rule_pack_content_hash: "sha256:test",
  providers: CATALOG,
  rules: [],
  predicates: {},
} as unknown as RuleSet;
const CONFIG: Config = {
  reachability_max_depth: 3,
  scanned_at: "2026-06-04T00:00:00Z",
  engine_commit_sha: null,
  total_files_count: 1,
};

async function evidenceKindsFor(file: ParsedFile): Promise<
  ReadonlyArray<{ kind: string; provider: string; detail: string }>
> {
  const model = await buildProjectModel({
    parsedFiles: [file],
    ruleSet: RULESET,
    config: CONFIG,
    bespokeAdapters: ALL_ADAPTERS,
  });
  return model.handlers.flatMap((h) =>
    h.evidence.map((e) => ({ kind: e.kind, provider: e.provider, detail: e.detail })),
  );
}

describe("Go reachability — collectCallsGo + buildSymbolTable", () => {
  it("resolves a handler's call into a local helper (util-extracted verification)", async () => {
    const file = await parse(
      "webhooks/stripe.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n\t"github.com/stripe/stripe-go/webhook"\n)\n\n' +
        "func StripeWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tverifyStripe(body, r.Header.Get("Stripe-Signature"))\n' +
        "}\n\n" +
        "func verifyStripe(body []byte, sig string) {\n" +
        "\t_, _ = webhook.ConstructEvent(body, sig, secret)\n" +
        "}\n",
    );
    const symbols = computeReachableSymbols({
      handler_body_node: namedFn(file, "StripeWebhook"),
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    });
    const qnames = symbols.map((s) => s.qualified_name);
    expect(qnames).toContain("verifyStripe"); // hop 1
    expect(qnames).toContain("webhook.ConstructEvent"); // hop 2 — resolved into the helper body
  });

  it("surfaces hmac.Equal + next.ServeHTTP from a func(http.Handler) http.Handler middleware", async () => {
    const file = await parse(
      "mw/auth.go",
      'package mw\n\nimport (\n\t"crypto/hmac"\n\t"io"\n\t"net/http"\n)\n\n' +
        "func AuthMiddleware(next http.Handler) http.Handler {\n" +
        "\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n" +
        "\t\tbody, _ := io.ReadAll(r.Body)\n" +
        '\t\tsig := r.Header.Get("X-Signature")\n' +
        "\t\tif !hmac.Equal([]byte(expected), []byte(sig)) {\n" +
        "\t\t\treturn\n" +
        "\t\t}\n" +
        "\t\t_ = body\n" +
        "\t\tnext.ServeHTTP(w, r)\n" +
        "\t})\n" +
        "}\n",
    );
    const symbols = computeReachableSymbols({
      handler_body_node: firstFuncLiteral(file),
      handler_file: file,
      all_files: [file],
      imports: file.imports,
      maxDepth: 3,
    });
    const qnames = symbols.map((s) => s.qualified_name);
    expect(qnames).toContain("hmac.Equal");
    expect(qnames).toContain("next.ServeHTTP"); // the middleware-wrapper continuation linkage
  });
});

describe("Go SDK verify recognition — buildProjectModel evidence", () => {
  it("recognizes stripe webhook.ConstructEvent as a stripe sdk_verify_call", async () => {
    const file = await parse(
      "webhooks/stripe.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n\t"github.com/stripe/stripe-go/webhook"\n)\n\n' +
        "func StripeWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("Stripe-Signature")\n' +
        "\t_, _ = webhook.ConstructEvent(body, sig, secret)\n" +
        "}\n",
    );
    const ev = await evidenceKindsFor(file);
    expect(ev).toContainEqual({
      kind: "sdk_verify_call",
      provider: "stripe",
      detail: "webhook.ConstructEvent",
    });
  });

  it("matches go-github by import-path PREFIX tolerating /v62/ + recognizes ValidatePayload", async () => {
    const file = await parse(
      "webhooks/github.go",
      'package webhooks\n\nimport (\n\t"net/http"\n\tgh "github.com/google/go-github/v62/github"\n)\n\n' +
        "func GithubWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        '\tpayload, _ := gh.ValidatePayload(r, []byte("secret"))\n' +
        "\t_ = payload\n" +
        "}\n",
    );
    const ev = await evidenceKindsFor(file);
    // PREFIX import match: catalog "github.com/google/go-github" matches the /v62/github import.
    expect(ev).toContainEqual({
      kind: "sdk_import",
      provider: "github",
      detail: "github.com/google/go-github",
    });
    expect(ev.some((e) => e.kind === "sdk_verify_call" && e.provider === "github")).toBe(true);
  });

  it("recognizes the Svix wh.Verify(...) instance method ONLY when the svix Go SDK is imported", async () => {
    const withSvix = await parse(
      "webhooks/svix.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n\tsvix "github.com/svix/svix-webhooks/go"\n)\n\n' +
        "func SvixWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("webhook-signature")\n' +
        "\twh, _ := svix.NewWebhook(secret)\n" +
        "\t_ = wh.Verify(body, r.Header)\n" +
        "\t_ = sig\n" +
        "}\n",
    );
    const evSvix = await evidenceKindsFor(withSvix);
    expect(evSvix).toContainEqual({
      kind: "sdk_verify_call",
      provider: "standardwebhooks",
      detail: "Verify",
    });

    // Control: the SAME .Verify() shape with NO svix import must NOT attribute to standardwebhooks.
    const noSvix = await parse(
      "webhooks/other.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n)\n\n' +
        "func OtherWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("X-Signature")\n' +
        "\t_ = thing.Verify(body, sig)\n" +
        "}\n",
    );
    const evNo = await evidenceKindsFor(noSvix);
    expect(evNo.some((e) => e.kind === "sdk_verify_call" && e.provider === "standardwebhooks")).toBe(
      false,
    );
  });

  it("does NOT assert a verify call on an import-only handler (no ConstructEvent)", async () => {
    const file = await parse(
      "webhooks/importonly.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n\t"github.com/stripe/stripe-go/webhook"\n)\n\n' +
        "func StripeWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("Stripe-Signature")\n' +
        "\t_ = body\n" +
        "\t_ = sig\n" +
        "\t_ = webhook.MaxBodyBytes\n" +
        "}\n",
    );
    const ev = await evidenceKindsFor(file);
    // The SDK is imported (sdk_import present) but no verify call → no sdk_verify_call evidence.
    expect(ev.some((e) => e.kind === "sdk_import" && e.provider === "stripe")).toBe(true);
    expect(ev.some((e) => e.kind === "sdk_verify_call")).toBe(false);
  });
});
