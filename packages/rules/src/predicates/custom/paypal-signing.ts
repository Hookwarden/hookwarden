// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — PayPal. PayPal webhooks are signed asymmetrically
// (SHA256withRSA over `transmission_id|transmission_time|webhook_id|crc32(body)`), not HMAC, so
// the shared manual-HMAC recognition never sees them. A receiver verifies one of three ways
// (https://developer.paypal.com/api/rest/webhooks/rest/):
//   1. SDK: `paypal.notification.webhookEvent.verify(...)` (Node) / `WebhookEvent.verify(...)`
//      (Python) — catalog sdk_verify_calls → verified (library-verified emits it).
//   2. Postback: POST the paypal-* headers + event to `/v1/notifications/verify-webhook-signature`
//      and check `verification_status === "SUCCESS"` → treated as verified. Detected by the
//      endpoint path (or the PHP SDK's VerifyWebhookSignature class) in the handler's file, since
//      the URL is a string literal, not a call name.
//   3. Local RSA: crypto.createVerify / openssl_verify / x509 cert loading → manual-review. A check
//      exists, but whether the cert URL is pinned to a PayPal host and the CRC32 input is built
//      correctly can't be decided statically.
// Anything else → not-verified.
//
// Registered for both the JS/Python slot and the PHP slot (PHP handlers have no
// reachable_symbols, so the text signals carry PHP).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import {
  CUSTOM_PHP_SIGNING_PREDICATES,
  CUSTOM_SIGNING_PREDICATES,
  delegatesRawRequestToImportedCallee,
} from "../missing-signature-verification.js";
import { createVerifyAfterSideEffectPredicate } from "../verify-after-side-effect.js";

const POSTBACK_HINT = /verify-webhook-signature|VerifyWebhookSignature/;
const LOCAL_RSA_HINT =
  /createVerify\s*\(|crypto\.verify\s*\(|openssl_verify\s*\(|load_pem_x509_certificate/;

function fileTextOf(handler: WebhookHandler, model: ProjectModel): string {
  return (
    model?.parsed_files?.find((f) => f.file_path === handler.file_path)?.source_text ??
    handler.redacted_snippet
  );
}

export const paypalSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  model: ProjectModel,
) => {
  if (handler.provider !== "paypal") return null;
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "paypal")) {
    return null;
  }
  const sdkCalls = PROVIDER_CATALOG["paypal"]?.sdk_verify_calls ?? [];
  if (
    handler.reachable_symbols.some((s) =>
      sdkCalls.some((c) => s.qualified_name === c || s.qualified_name.endsWith(`.${c}`)),
    )
  ) {
    return null;
  }
  const fileText = fileTextOf(handler, model);
  if (POSTBACK_HINT.test(fileText)) return null;
  if (LOCAL_RSA_HINT.test(fileText)) return "manual-review";
  if (delegatesRawRequestToImportedCallee(handler)) return "manual-review";
  return "not-verified";
};

CUSTOM_SIGNING_PREDICATES["paypal"] = paypalSigningPredicate;
CUSTOM_PHP_SIGNING_PREDICATES["paypal"] = paypalSigningPredicate;

// The postback IS the verification, but it's an outbound `fetch`/`axios.post` the engine's
// statement-order walk (handler-cfg) can't tell apart from a side effect — it only sees call names,
// not the URL. So every correct postback handler would get verify-after-side-effect.
// ponytail: postback handlers skip the ordering check entirely, so a real side effect placed BEFORE
// the postback goes unreported; teach handler-cfg to mark verify-URL calls as verification to fix.
const genericVerifyAfterSideEffect = createVerifyAfterSideEffectPredicate("paypal");
export const paypalVerifyAfterSideEffectPredicate: RulePredicate = async (handler, model) => {
  if (handler.provider !== "paypal") return null;
  if (POSTBACK_HINT.test(fileTextOf(handler, model))) return null;
  return genericVerifyAfterSideEffect(handler, model);
};
