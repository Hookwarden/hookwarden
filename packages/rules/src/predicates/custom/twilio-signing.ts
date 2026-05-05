// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — first occupant. Twilio's webhook signing scheme uses
// URL+sorted-params canonical-string + HMAC-SHA1 + base64. The canonical-string construction
// does NOT fit any parameterized signing_input_format recipe, so the catalog entry sets
// signing_input_format: 'custom' and the missing-signature-verification factory dispatches
// here via CUSTOM_SIGNING_PREDICATES['twilio'].
//
// What is custom: the BODY of the verification check (entry-point detection — did the handler
// attempt to verify at all?). What is NOT custom: catalog-typed access to sdk_verify_calls
// and sdk_packages drives the SDK-reach check; manual-HMAC entry detection is provider-
// agnostic. The "URL+sorted-params canonical-string CONSTRUCTION" semantics (a value-
// correctness concern) are the wrong-hmac-algorithm + raw-body-misuse rules' responsibility.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import { isManualHmacEntry, reachesSdkVerifyCall } from "../_helpers.js";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

const TWILIO_CATALOG =
  PROVIDER_CATALOG["twilio"] ??
  (() => {
    throw new Error("PROVIDER_CATALOG entry for 'twilio' is missing");
  })();

export const twilioSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "twilio") return null;
  const symbols = handler.reachable_symbols;
  if (reachesSdkVerifyCall(symbols, TWILIO_CATALOG.sdk_verify_calls, TWILIO_CATALOG.sdk_packages)) {
    return null;
  }
  if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  return "not-verified";
};

// Side-effect registration: when missing-signature-verification.ts imports this module, the
// CUSTOM_SIGNING_PREDICATES['twilio'] slot is populated at module load (no dynamic import).
CUSTOM_SIGNING_PREDICATES["twilio"] = twilioSigningPredicate;
