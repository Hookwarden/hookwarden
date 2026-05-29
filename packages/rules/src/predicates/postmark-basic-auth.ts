// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// 08.3 Plan 08 — Postmark missing-basic-auth + missing-ip-allowlist rules.
// Together with postmarkSigningPredicate (custom slot) and the standard
// timing-unsafe-comparison / raw-body-misuse / unreachable-verification
// rules, this completes the Basic Auth + IP allowlist coverage.
//
// Architectural split:
//   - postmarkSigningPredicate (custom slot): emits not-verified ONLY when
//     NEITHER auth layer is reachable (handler is completely open).
//   - postmarkMissingBasicAuthPredicate (here): emits manual-review when
//     IP allowlist is reachable but Basic Auth is NOT (partial coverage —
//     IP-only auth is brittle behind load balancers / CDNs).
//   - postmarkMissingIpAllowlistPredicate (here): emits manual-review when
//     Basic Auth is reachable but IP allowlist is NOT (partial coverage —
//     Basic Auth alone exposes the credentials to log surfaces).
//
// The "completely open" and "fully covered" cases are both handled cleanly:
// open → not-verified (custom slot), fully covered → null (both rules).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { reachesBasicAuthRead, reachesIpAllowlistRead } from "./custom/postmark-signing.js";

export const postmarkMissingBasicAuthPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "postmark") return null;
  const basic = reachesBasicAuthRead(handler.reachable_symbols);
  const ip = reachesIpAllowlistRead(handler.reachable_symbols);
  // Both layers covered — defer.
  if (basic && ip) return null;
  // Neither layer covered — defer to the custom-signing predicate's
  // not-verified emission to avoid double-flagging.
  if (!basic && !ip) return null;
  // IP only — Basic Auth missing.
  if (ip && !basic) return "manual-review";
  return null;
};

export const postmarkMissingIpAllowlistPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "postmark") return null;
  const basic = reachesBasicAuthRead(handler.reachable_symbols);
  const ip = reachesIpAllowlistRead(handler.reachable_symbols);
  if (basic && ip) return null;
  if (!basic && !ip) return null;
  if (basic && !ip) return "manual-review";
  return null;
};
