// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — third occupant (Twilio's twilio-signing.ts is first,
// standardwebhooks-signing.ts is second). HubSpot v3 signs over the canonical-string
// `${httpMethod}${requestURI}${rawBody}${timestamp}` with HMAC-SHA256, base64-encoded,
// under `X-HubSpot-Signature-v3` with the timestamp delivered in
// `X-HubSpot-Request-Timestamp`. The canonical-string interpolates the request
// method and URL — does NOT fit any parameterized signing_input_format recipe — so
// the catalog entry sets signing_input_format: 'custom' and the
// missing-signature-verification factory dispatches here via
// CUSTOM_SIGNING_PREDICATES['hubspot'].
//
// What is custom: the BODY of the verification check (entry-point detection — did
// the handler attempt to verify at all?). What is NOT custom: catalog-typed access
// to sdk_verify_calls and sdk_packages drives the SDK-reach check; manual-HMAC entry
// detection is provider-agnostic. The "v3 concatenation-order CONSTRUCTION"
// semantics (a value-correctness concern — e.g. handler appended segments in the
// wrong order) are wrong-hmac-algorithm + raw-body-misuse rules' responsibility,
// and tests in hubspot.test.ts assert at least 2 concatenation-order negatives
// surface via those rules.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../../catalog.js";
import { isManualHmacEntry, reachesSdkVerifyCall } from "../_helpers.js";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

const HUBSPOT_CATALOG =
  PROVIDER_CATALOG["hubspot"] ??
  (() => {
    throw new Error("PROVIDER_CATALOG entry for 'hubspot' is missing");
  })();

export const hubspotSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "hubspot") return null;
  const symbols = handler.reachable_symbols;
  if (
    reachesSdkVerifyCall(symbols, HUBSPOT_CATALOG.sdk_verify_calls, HUBSPOT_CATALOG.sdk_packages)
  ) {
    return null;
  }
  if (symbols.some((s) => isManualHmacEntry(s.qualified_name))) return null;
  // Path B (parity with twilio-signing, standardwebhooks-signing) — inline-middleware
  // sdk_verify_call evidence emitted by the build.ts overlay. Without this branch,
  // handlers whose verification lives in an arrow-fn route arg get false-flagged.
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "hubspot")) {
    return null;
  }
  return "not-verified";
};

// Side-effect registration. Side-effect imports of custom predicate files live in
// predicates/index.ts to populate CUSTOM_SIGNING_PREDICATES['hubspot'] at module-load.
CUSTOM_SIGNING_PREDICATES["hubspot"] = hubspotSigningPredicate;
