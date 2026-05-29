// RULES-02 detection #2, catalog-parameterized factory (D-90, D-91, D-93). Manual HMAC path is
// reachable but a constant-time comparison (`crypto.timingSafeEqual` / `hmac.compare_digest`)
// is not — the handler is rolling its own equality check, leaking timing information.
//
// SDK path is exempt — the SDK handles comparison internally.
//
// Pure: no fs / http / network / process / node:* (D-28).
//
// Phase 8.1 Plan 08: dispatch to PHP-specific AST inspection when the handler's source file is
// tree-sitter-php. Engine reachability is bounded to babel + tree-sitter-python in v1, so PHP
// handlers' reachable_symbols are empty — the JS/Py path would always return null. PHP path
// walks the handler's source range for the D-09 dangerous comparisons.

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isConstantTimeCompare, isManualHmacEntry, reachesSdkVerifyCall } from "./_helpers.js";
import {
  findInsecureStringComparisons,
  isPhpHashEqualsCall,
  type PhpSyntaxNode,
  type PhpTree,
  walkPhpCalls,
} from "./_helpers-php.js";

export function createTimingUnsafeComparisonPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;

    // Path B (PHP) — direct AST inspection when the handler's source file is PHP.
    // Defensive: existing tests cast model as never; tolerate missing parsed_files.
    const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
    if (parsedFile?.dialect === "tree-sitter-php") {
      return evaluatePhpTimingUnsafe(handler, parsedFile, catalog);
    }

    // Path A (JS / Python) — reachable_symbols populated by engine reachability D-34.
    const symbols = handler.reachable_symbols;
    if (reachesSdkVerifyCall(symbols, catalog.sdk_verify_calls, catalog.sdk_packages)) return null;
    if (!symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    if (symbols.some((s) => isConstantTimeCompare(s.qualified_name))) return null;
    return "not-verified";
  };
}

function evaluatePhpTimingUnsafe(
  handler: WebhookHandler,
  parsedFile: {
    readonly dialect: string;
    readonly parse_error: unknown;
    readonly raw_ast: unknown;
  },
  catalog: ProviderCatalogEntry,
): "not-verified" | null {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;
  // SDK path exemption — if the catalog's sdk_verify_call evidence overlay (Phase 8.1 Plan 07
  // PHP build.ts overlay) emitted a verify entry, the SDK handles comparison internally.
  if (
    catalog.sdk_verify_calls.length > 0 &&
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === handler.provider)
  ) {
    return null;
  }

  const tree = parsedFile.raw_ast as PhpTree;
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;

  const calls = walkPhpCalls(root);
  // Safe path — hash_equals present → emit nothing.
  const usesHashEquals = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    return fnNode !== null && isPhpHashEqualsCall(fnNode.text);
  });
  if (usesHashEquals) return null;

  // Manual HMAC must be present — otherwise rule does not apply (other rules cover
  // missing-verification cases).
  const usesHashHmac = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    if (!fnNode) return false;
    const t = fnNode.text;
    return t === "hash_hmac" || t === "\\hash_hmac";
  });
  if (!usesHashHmac) return null;

  // Insecure comparison present → not-verified.
  const insecure = findInsecureStringComparisons(root);
  if (insecure.length === 0) return null;
  return "not-verified";
}

export const stripeTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

export const shopifyTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
  );

export const twilioTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
  );

export const slackTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] ?? throwMissing("slack"),
  );

export const squareTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "square",
    PROVIDER_CATALOG["square"] ?? throwMissing("square"),
  );

export const zendeskTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
  );

export const intercomTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] ?? throwMissing("intercom"),
  );

export const standardwebhooksTimingUnsafeComparisonPredicate: RulePredicate =
  createTimingUnsafeComparisonPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] ?? throwMissing("standardwebhooks"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
