// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — PayPal. PayPal webhooks are signed asymmetrically
// (SHA256withRSA over `transmission_id|transmission_time|webhook_id|crc32(body)`), not HMAC, so
// the shared manual-HMAC recognition never sees them. A receiver verifies one of three ways
// (https://developer.paypal.com/api/rest/webhooks/rest/):
//   1. SDK: `paypal.notification.webhookEvent.verify(...)` (Node) / `WebhookEvent.verify(...)`
//      (Python).
//   2. Postback: POST the paypal-* headers + event to `/v1/notifications/verify-webhook-signature`.
//   3. Local RSA: crypto.createVerify / openssl_verify / x509 cert loading.
// None of these throw on a forged event — the SDK returns/calls back with a status and the
// postback answers HTTP 200 with `verification_status: "FAILURE"` — so making the call proves
// nothing unless the handler checks the result. Verdicts:
//   SDK / postback + result checked  → verified (paypal/library-verified emits it)
//   SDK / postback, result unchecked → manual-review
//   local RSA                        → manual-review (cert-URL pinning + CRC32 input undecidable)
//   postback / RSA only elsewhere in the file (a helper) → manual-review (can't see the check)
//   nothing                          → not-verified
//
// Signals are matched against the handler's own source lines, NOT redacted_snippet (which
// replaces every string literal — the endpoint URL and "SUCCESS" — with placeholders) and NOT the
// whole file (another route or a comment in the same file must not vouch for this handler).

import type { ParsedFile, ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import { reachesSdkVerifyCall } from "../_helpers.js";
import {
  CUSTOM_PHP_SIGNING_PREDICATES,
  CUSTOM_SIGNING_PREDICATES,
  delegatesRawRequestToImportedCallee,
} from "../missing-signature-verification.js";
import { createVerifyAfterSideEffectPredicate } from "../verify-after-side-effect.js";

const POSTBACK_HINT = /verify-webhook-signature|VerifyWebhookSignature/;
const LOCAL_RSA_HINT =
  /createVerify\s*\(|crypto\.verify\s*\(|openssl_verify\s*\(|load_pem_x509_certificate/;
// Result checks: the postback / Node SDK status field compared to SUCCESS, or the verify call
// used directly as an `if` condition (Python's WebhookEvent.verify returns a bool).
const STATUS_CHECKED = /verification_status|verificationStatus/;
const SUCCESS_LITERAL = /SUCCESS/;
const VERIFY_IN_CONDITION = /\bif\b[^\n]*\bverify\w*\s*\(/i;

type PaypalVerification = "checked" | "unchecked" | "indirect" | "none";

function parsedFileOf(handler: WebhookHandler, model: ProjectModel): ParsedFile | undefined {
  return model?.parsed_files?.find((f) => f.file_path === handler.file_path);
}

function handlerSource(handler: WebhookHandler, file: ParsedFile | undefined): string {
  if (file === undefined) return handler.redacted_snippet;
  const lines = file.source_text.split("\n");
  return lines.slice(handler.location.line - 1, handler.location.end_line).join("\n");
}

function classify(handler: WebhookHandler, model: ProjectModel): PaypalVerification {
  const file = parsedFileOf(handler, model);
  const scope = handlerSource(handler, file);
  const sdkCalls = PROVIDER_CATALOG["paypal"]?.sdk_verify_calls ?? [];
  const sdk =
    handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "paypal") ||
    reachesSdkVerifyCall(handler.reachable_symbols, sdkCalls, []);
  if (sdk || POSTBACK_HINT.test(scope)) {
    const checked =
      (STATUS_CHECKED.test(scope) && SUCCESS_LITERAL.test(scope)) ||
      VERIFY_IN_CONDITION.test(scope);
    return checked ? "checked" : "unchecked";
  }
  if (LOCAL_RSA_HINT.test(scope)) return "indirect";
  const fileText = file?.source_text ?? "";
  if (POSTBACK_HINT.test(fileText) || LOCAL_RSA_HINT.test(fileText)) return "indirect";
  return "none";
}

// A file tree-sitter/babel couldn't parse cleanly has no trustworthy handler body (D-27) — defer,
// matching the generic PHP path.
function unparseable(handler: WebhookHandler, model: ProjectModel): boolean {
  const file = parsedFileOf(handler, model);
  return file !== undefined && (file.parse_error !== null || file.raw_ast === null);
}

export const paypalSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "paypal") return null;
  if (unparseable(handler, model)) return null;
  const verification = classify(handler, model);
  if (verification === "checked") return null;
  if (verification !== "none") return "manual-review";
  if (delegatesRawRequestToImportedCallee(handler)) return "manual-review";
  return "not-verified";
};

CUSTOM_SIGNING_PREDICATES["paypal"] = paypalSigningPredicate;
CUSTOM_PHP_SIGNING_PREDICATES["paypal"] = paypalSigningPredicate;

// library-verified for PayPal is result-aware (unlike the generic factory, which trusts any
// reachable SDK call because e.g. Stripe's constructEvent throws on a bad signature).
export const paypalLibraryVerifiedPredicate: RulePredicate = async (handler, model) => {
  if (handler.provider !== "paypal") return null;
  if (unparseable(handler, model)) return null;
  return classify(handler, model) === "checked" ? "verified" : null;
};

// The postback IS the verification, but it's an outbound `fetch`/`axios.post` the engine's
// statement-order walk (handler-cfg) can't tell apart from a side effect — it only sees call names,
// not the URL. So every correct postback handler would get verify-after-side-effect.
// ponytail: postback handlers skip the ordering check entirely, so a real side effect placed BEFORE
// the postback goes unreported; teach handler-cfg to mark verify-URL calls as verification to fix.
const genericVerifyAfterSideEffect = createVerifyAfterSideEffectPredicate("paypal");
export const paypalVerifyAfterSideEffectPredicate: RulePredicate = async (handler, model) => {
  if (handler.provider !== "paypal") return null;
  if (POSTBACK_HINT.test(handlerSource(handler, parsedFileOf(handler, model)))) return null;
  return genericVerifyAfterSideEffect(handler, model);
};
