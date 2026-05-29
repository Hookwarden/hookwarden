// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — second occupant (Twilio's twilio-signing.ts is first).
// Standard Webhooks (https://www.standardwebhooks.com) signs HMAC-SHA256 over
// `{webhook-id}.{webhook-timestamp}.{rawBody}` and emits the result as base64. The
// canonical-string includes a non-payload message id, so the signing recipe does NOT fit
// the parameterized `timestamp_dot_body` shape used by Slack/Zendesk — the catalog entry
// sets signing_input_format: 'custom' and the missing-signature-verification factory
// dispatches here via CUSTOM_SIGNING_PREDICATES['standardwebhooks'].
//
// Library-prong-only in this commit: the predicate confirms a `standardwebhooks` library
// import + a `.verify()` call site is reachable, OR a manual HMAC entry-point exists.
// When either is reachable → return null (defer to other rules). When neither → emit
// `not-verified`.
//
// What is NOT covered here: structural AST detection of hand-rolled implementations of
// the spec (Clerk CVE-2025-53548 shape — HMAC-SHA256 over `{id}.{ts}.{body}` template
// with the verification step missing or broken). That detection requires cross-language
// AST matching and is deferred to Plan 16b.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import { isManualHmacEntry, reachesSdkVerifyCall } from "../_helpers.js";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

const STANDARDWEBHOOKS_CATALOG =
  PROVIDER_CATALOG["standardwebhooks"] ??
  (() => {
    throw new Error("PROVIDER_CATALOG entry for 'standardwebhooks' is missing");
  })();

export const standardwebhooksSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "standardwebhooks") return null;
  const symbols = handler.reachable_symbols;
  if (
    reachesSdkVerifyCall(
      symbols,
      STANDARDWEBHOOKS_CATALOG.sdk_verify_calls,
      STANDARDWEBHOOKS_CATALOG.sdk_packages,
    )
  ) {
    return null;
  }
  if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  // Path B (parity with library-verified-recognition) — inline-middleware sdk_verify_call
  // evidence emitted by the build.ts overlay (Phase 8.1 Plan 07 PHP overlay + inline
  // middleware overlay). Without this branch, handlers whose verification lives in an
  // arrow-fn route arg get false-flagged as not-verified.
  if (
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "standardwebhooks")
  ) {
    return null;
  }
  return "not-verified";
};

// Side-effect registration: when missing-signature-verification.ts imports this module
// (transitively via predicates/index.ts), CUSTOM_SIGNING_PREDICATES['standardwebhooks']
// is populated at module-load time. No dynamic import.
CUSTOM_SIGNING_PREDICATES["standardwebhooks"] = standardwebhooksSigningPredicate;
