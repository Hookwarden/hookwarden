// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// 08.3 Plan 07 — Mailchimp url-secret-in-path rule. NEW rule kind: detects
// handlers whose authentication signal is a URL path-parameter that resembles
// a secret segment (`:secret`, `:token`, `<secret>`, `<token>`, etc.).
//
// Why a separate rule (not just missing-signature-verification):
//   - URL-secret-in-path IS authentication of a sort — the secret is delivered
//     even if it's not an HMAC. Treating it as "not-verified" alongside open
//     handlers conflates two different failure modes with different remediations.
//   - Mailchimp customers ship a mix: some on URL-secret only, some on URL-
//     secret + IP allowlist, some on a modern HMAC option if their docs era
//     supports it. The rule surfaces `manual-review` rather than not-verified
//     to steer users toward additionally verifying via HMAC where available,
//     while not penalising the historically-valid baseline.
//
// Pattern set (case-insensitive substring match on the route_pattern segment):
//   - Express/Koa/Hono `/:secret`, `/:token`, `/:webhookSecret`, `/:apiKey`
//   - FastAPI/Starlette `/{secret}`, `/{token}`
//   - Laravel `/{secret}`, `/{token}` (same)
//   - Generic placeholder forms `<secret>`, `<token>`
// The match is intentionally conservative — only patterns that are clearly
// secret-shaped param names. Generic placeholders like `:id` or `:slug` do
// NOT match; those are resource identifiers, not auth tokens.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";

const SECRET_NAME_FRAGMENTS = ["secret", "token", "apikey", "webhookkey", "signingkey"];

export function hasUrlSecretInPath(routePattern: string): boolean {
  const lc = routePattern.toLowerCase();
  for (const name of SECRET_NAME_FRAGMENTS) {
    if (lc.includes(`:${name}`)) return true;
    if (lc.includes(`{${name}}`)) return true;
    if (lc.includes(`<${name}>`)) return true;
  }
  return false;
}

export const mailchimpUrlSecretInPathPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "mailchimp") return null;
  if (!hasUrlSecretInPath(handler.route_pattern)) return null;
  return "manual-review";
};
