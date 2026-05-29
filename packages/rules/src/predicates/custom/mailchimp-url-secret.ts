// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — fourth occupant. Mailchimp Marketing's default
// webhook authentication model is URL-secret-in-path (the secret is delivered
// as a route segment, not as a header HMAC). The catalog entry sets
// signing_input_format: 'custom' and signature_header: [] (no header), and the
// missing-signature-verification factory dispatches here via
// CUSTOM_SIGNING_PREDICATES['mailchimp'].
//
// What this slot answers: "did the handler accept the request without any
// authentication signal at all?" If the handler's route_pattern includes a
// path-parameter that looks like a secret segment (`:secret`, `:token`,
// `<secret>`, `<token>`) we treat it as "authenticated via URL-secret" and
// defer to the url-secret-in-path rule for the SOC2-evidence-bearing
// manual-review finding. If neither a path-secret segment nor a manual HMAC
// entry is reachable, the handler is completely open → not-verified.
//
// The url-secret-in-path RULE (separate from this signing-slot predicate)
// fires manual-review on handlers that DO use a URL-secret segment, steering
// users toward additionally verifying via HMAC where Mailchimp offers it.
// See predicates/mailchimp-url-secret-in-path.ts for that rule's predicate.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "../_helpers.js";
import { hasUrlSecretInPath } from "../mailchimp-url-secret-in-path.js";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

export const mailchimpSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "mailchimp") return null;
  // Authenticated via URL-secret — defer to the url-secret-in-path rule, not here.
  if (hasUrlSecretInPath(handler.route_pattern)) return null;
  // Manual HMAC entry-point reachable — verification attempted; defer to other rules.
  if (handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  // Path B (parity with twilio/standardwebhooks/hubspot) — inline-middleware
  // sdk_verify_call evidence emitted by the build.ts overlay.
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "mailchimp")) {
    return null;
  }
  return "not-verified";
};

CUSTOM_SIGNING_PREDICATES["mailchimp"] = mailchimpSigningPredicate;
