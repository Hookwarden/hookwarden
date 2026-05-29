// 08.3 Plan 10 (retrofit) — Sentry header-confusion rule.
//
// Sentry Integration Platform sends two `Sentry-Hook-*` headers:
//   - `Sentry-Hook-Signature` — the HMAC-SHA256 hex of the raw body
//   - `Sentry-Hook-Resource` — the event-type identifier (e.g. `issue.created`)
//
// A real, documented bug pattern is the handler HMAC-verifying the WRONG header:
// either reading `Sentry-Hook-Resource` thinking it's the signature, or computing
// HMAC but never reading the signature header at all (e.g. comparing against a
// hardcoded value or against the resource header). Every delivery silently fails
// verification.
//
// Heuristic: when manual HMAC IS reachable from a Sentry handler but no
// `signature_header_read` evidence is present (engine evidence only fires when
// the handler reads a header matching catalog.signature_header — for Sentry that's
// `Sentry-Hook-Signature`), emit `manual-review`. The handler is verifying but not
// reading the expected signature header; likely a header-confusion bug.
//
// Pure: no fs / http / network / process / node:* (D-28).

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { isManualHmacEntry } from "./_helpers.js";

export const sentryHeaderConfusionPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "sentry") return null;

  // Only fire when the handler is actually attempting manual HMAC verification.
  // (missing-signature-verification covers the "no verification at all" case.)
  if (!handler.reachable_symbols.some((s) => isManualHmacEntry(s.qualified_name))) {
    return null;
  }

  // If signature_header_read evidence is present, the handler is reading the
  // catalog signature header (sentry-hook-signature) — no confusion bug.
  if (handler.evidence.some((e) => e.kind === "signature_header_read")) return null;

  return "manual-review";
};
