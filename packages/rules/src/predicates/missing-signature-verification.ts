// RULES-02 detection #1, catalog-parameterized factory (D-90, D-91, D-92, D-93). Emits
// not-verified when neither the provider's SDK verify call nor a manual HMAC entry-point
// is reachable from the handler within the engine's bounded reachability budget (D-34).
// Conservative: defers (returns null) when EITHER path is reachable — other rules cover the
// manual-HMAC sub-cases (timing-unsafe, missing-timestamp, wrong-algo) and library-verified
// covers the SDK case.
//
// D-92 custom-signing slot: when `catalog.signing_input_format === 'custom'`, dispatch to a
// provider-specific predicate registered in CUSTOM_SIGNING_PREDICATES (e.g. Twilio's
// URL+sorted-params canonical-string scheme lands in plan 06.3 at predicates/custom/twilio-
// signing.ts and registers itself there). When no custom predicate is registered for the
// provider, return null — defer to other rules rather than false-flag.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type {
  ProjectModel,
  ProviderCatalogEntry,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";
import { isManualHmacEntry, reachesSdkVerifyCall } from "./_helpers.js";
import { type PhpSyntaxNode, type PhpTree, walkPhpCalls } from "./_helpers-php.js";

// D-92 registry. Custom-signing predicate files under predicates/custom/<provider>-signing.ts
// register their predicate here at module-load time. Side-effect imports of custom predicate
// files live in predicates/index.ts (NOT here) to avoid a module-load circular: each custom
// predicate file imports CUSTOM_SIGNING_PREDICATES from this module, so this module must
// finish initializing before any custom predicate body runs.
export const CUSTOM_SIGNING_PREDICATES: Record<string, RulePredicate> = {};

export function createMissingSignatureVerificationPredicate(
  provider: string,
  catalog: ProviderCatalogEntry,
): RulePredicate {
  return async (handler: WebhookHandler, model: ProjectModel) => {
    if (handler.provider !== provider) return null;

    // Phase 8.1 Plan 10 — PHP dispatch. Engine reach pass is bounded to babel + tree-sitter-python;
    // PHP handlers have empty reachable_symbols. Use the handler's source-text scope to detect
    // manual hash_hmac OR the build.ts PHP overlay's sdk_verify_call evidence (Plan 07).
    const parsedFile = model?.parsed_files?.find((f) => f.file_path === handler.file_path);
    if (parsedFile?.dialect === "tree-sitter-php") {
      return evaluatePhpMissingVerification(handler, parsedFile, catalog, provider, model);
    }

    const symbols = handler.reachable_symbols;

    if (catalog.signing_input_format === "custom") {
      const custom = CUSTOM_SIGNING_PREDICATES[provider];
      if (custom !== undefined) return custom(handler, model);
      return null;
    }

    if (reachesSdkVerifyCall(symbols, catalog.sdk_verify_calls, catalog.sdk_packages)) {
      return null;
    }
    if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
    // Path B (parity with library-verified-recognition) — `sdk_verify_call` evidence emitted
    // by build.ts overlays for shapes that don't surface in `reachable_symbols`: the PHP
    // overlay (Plan 07) and the inline-middleware verify overlay (collectInlineMiddleware
    // VerifyEvidence). Without this branch, JS/TS handlers whose verification lives in an
    // inline route-arg arrow middleware get flagged here even though library-verified
    // recognises them — producing a contradictory "verified AND not-verified" finding pair.
    if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === provider)) {
      return null;
    }
    return "not-verified";
  };
}

function evaluatePhpMissingVerification(
  handler: WebhookHandler,
  parsedFile: { readonly parse_error: unknown; readonly raw_ast: unknown },
  _catalog: ProviderCatalogEntry,
  provider: string,
  _model: ProjectModel,
): "not-verified" | null {
  if (parsedFile.parse_error !== null || parsedFile.raw_ast === null) return null;

  // Note: PHP path intentionally does NOT dispatch to CUSTOM_SIGNING_PREDICATES. Custom
  // predicates (e.g. twilio-signing) use reachable_symbols which is empty for PHP. The
  // PHP-aware checks below — evidence-based SDK detection AND direct hash_hmac walk —
  // are sufficient for the v1 PHP shape regardless of signing_input_format.

  // Path A — SDK verify call surfaces as evidence via the build.ts PHP overlay (Plan 07).
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === provider)) {
    return null;
  }

  // Path B — manual HMAC: walk the handler scope for hash_hmac calls.
  const tree = parsedFile.raw_ast as PhpTree;
  const scopeNode = (handler as unknown as { handler_body_node?: PhpSyntaxNode }).handler_body_node;
  const root: PhpSyntaxNode = scopeNode ?? tree.rootNode;
  const calls = walkPhpCalls(root);
  const usesHashHmac = calls.some((c) => {
    if (c.kind !== "function") return false;
    const fnNode = c.node.childForFieldName("function");
    if (!fnNode) return false;
    const t = fnNode.text;
    return t === "hash_hmac" || t === "\\hash_hmac";
  });
  if (usesHashHmac) return null;

  return "not-verified";
}

export const stripeMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "stripe",
    PROVIDER_CATALOG["stripe"] ?? throwMissing("stripe"),
  );

export const githubMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "github",
    PROVIDER_CATALOG["github"] ?? throwMissing("github"),
  );

export const shopifyMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "shopify",
    PROVIDER_CATALOG["shopify"] ?? throwMissing("shopify"),
  );

export const twilioMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "twilio",
    PROVIDER_CATALOG["twilio"] ?? throwMissing("twilio"),
  );

export const slackMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "slack",
    PROVIDER_CATALOG["slack"] ?? throwMissing("slack"),
  );

export const squareMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "square",
    PROVIDER_CATALOG["square"] ?? throwMissing("square"),
  );

export const zendeskMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "zendesk",
    PROVIDER_CATALOG["zendesk"] ?? throwMissing("zendesk"),
  );

export const intercomMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "intercom",
    PROVIDER_CATALOG["intercom"] ?? throwMissing("intercom"),
  );

export const linearMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "linear",
    PROVIDER_CATALOG["linear"] ?? throwMissing("linear"),
  );

export const docusignMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "docusign",
    PROVIDER_CATALOG["docusign"] ?? throwMissing("docusign"),
  );

export const auth0MissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "auth0",
    PROVIDER_CATALOG["auth0"] ?? throwMissing("auth0"),
  );

export const sentryMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "sentry",
    PROVIDER_CATALOG["sentry"] ?? throwMissing("sentry"),
  );

export const pagerdutyMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "pagerduty",
    PROVIDER_CATALOG["pagerduty"] ?? throwMissing("pagerduty"),
  );

export const bitbucketMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "bitbucket",
    PROVIDER_CATALOG["bitbucket"] ?? throwMissing("bitbucket"),
  );

// Notion's missing-signature-verification dispatches through the
// CUSTOM_SIGNING_PREDICATES['notion'] slot (catalog signing_input_format: 'custom').
// The factory wrapper keeps the per-provider export shape consistent.
export const notionMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "notion",
    PROVIDER_CATALOG["notion"] ?? throwMissing("notion"),
  );

export const calendlyMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "calendly",
    PROVIDER_CATALOG["calendly"] ?? throwMissing("calendly"),
  );

export const zoomMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "zoom",
    PROVIDER_CATALOG["zoom"] ?? throwMissing("zoom"),
  );

// HubSpot's missing-signature-verification dispatches through the
// CUSTOM_SIGNING_PREDICATES['hubspot'] slot (catalog signing_input_format: 'custom').
// The factory below is a thin wrapper to keep the per-provider export shape
// consistent across catalog/index.ts registration.
export const hubspotMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "hubspot",
    PROVIDER_CATALOG["hubspot"] ?? throwMissing("hubspot"),
  );

// Mailchimp's missing-signature-verification dispatches through the
// CUSTOM_SIGNING_PREDICATES['mailchimp'] slot (catalog signing_input_format: 'custom').
export const mailchimpMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "mailchimp",
    PROVIDER_CATALOG["mailchimp"] ?? throwMissing("mailchimp"),
  );

// Postmark's missing-signature-verification dispatches through the
// CUSTOM_SIGNING_PREDICATES['postmark'] slot (catalog signing_input_format: 'custom').
// The custom predicate evaluates Basic Auth + IP allowlist reachability.
export const postmarkMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "postmark",
    PROVIDER_CATALOG["postmark"] ?? throwMissing("postmark"),
  );

export const standardwebhooksMissingSignatureVerificationPredicate: RulePredicate =
  createMissingSignatureVerificationPredicate(
    "standardwebhooks",
    PROVIDER_CATALOG["standardwebhooks"] ?? throwMissing("standardwebhooks"),
  );

function throwMissing(provider: string): never {
  throw new Error(`PROVIDER_CATALOG entry for '${provider}' is missing`);
}
