// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).
//
// D-92 custom-predicate slot — fifth occupant. Postmark's default webhook
// authentication model is HTTP Basic Auth + IP allowlist — NOT HMAC. The
// catalog entry sets signing_input_format: 'custom' and the
// missing-signature-verification factory dispatches here via
// CUSTOM_SIGNING_PREDICATES['postmark'].
//
// What this slot answers: "did the handler attempt ANY authentication at all?"
// Postmark verification is two-layer:
//   - Basic Auth: handler reads `Authorization` header and compares to
//     env-var credential (constant-time)
//   - IP allowlist: handler reads `req.ip` / `X-Forwarded-For` and checks
//     against Postmark's documented IP range
// A handler that does NEITHER is completely open → emit not-verified.
// A handler that does AT LEAST ONE is "attempting verification" — defer to the
// dedicated missing-basic-auth and missing-ip-allowlist rules to surface the
// partial-coverage manual-review.
//
// Detection signals (reachability anchors):
//   - Basic Auth: any reach of `req.headers.authorization` or analogous
//     property access, OR sdk_verify_call evidence with provider=postmark
//   - IP allowlist: any reach of `req.ip` / `request.client.host` / etc.
//
// The detection is intentionally conservative — reachability is enough; we
// don't try to value-track the comparison. The dedicated rules (basic-auth /
// ip-allowlist) layer additional checks (timing-unsafe + presence) on top.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { CUSTOM_SIGNING_PREDICATES } from "../missing-signature-verification.js";

const BASIC_AUTH_READ_HINTS: ReadonlyArray<string> = [
  ".authorization",
  "headers.authorization",
  "request.authorization",
  "getHeader.authorization",
  // PHP request shape — Symfony / Laravel
  "headers.get.authorization",
  "request.headers.authorization",
  // Generic basic-auth helper recognised across frameworks
  "express.basicAuth",
  "fastify.basicAuth",
];

const IP_READ_HINTS: ReadonlyArray<string> = [
  ".ip",
  ".ips",
  ".socket.remoteAddress",
  "request.client.host",
  "request.remote_addr",
  // PHP / Laravel
  ".getClientIp",
  ".header.x-forwarded-for",
  "x-forwarded-for",
];

function reachesBasicAuthRead(symbols: ReadonlyArray<{ qualified_name: string }>): boolean {
  for (const s of symbols) {
    const n = s.qualified_name.toLowerCase();
    for (const h of BASIC_AUTH_READ_HINTS) {
      if (n.endsWith(h.toLowerCase()) || n.includes(h.toLowerCase())) return true;
    }
  }
  return false;
}

function reachesIpAllowlistRead(symbols: ReadonlyArray<{ qualified_name: string }>): boolean {
  for (const s of symbols) {
    const n = s.qualified_name.toLowerCase();
    for (const h of IP_READ_HINTS) {
      if (n.endsWith(h.toLowerCase()) || n.includes(h.toLowerCase())) return true;
    }
  }
  return false;
}

export const postmarkSigningPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "postmark") return null;
  // sdk_verify_call evidence from build.ts overlay (inline middleware) — defer.
  if (handler.evidence.some((e) => e.kind === "sdk_verify_call" && e.provider === "postmark")) {
    return null;
  }
  // At least one auth layer is reachable — defer to dedicated rules.
  if (reachesBasicAuthRead(handler.reachable_symbols)) return null;
  if (reachesIpAllowlistRead(handler.reachable_symbols)) return null;
  // Neither basic-auth nor ip-allowlist reachable — handler is completely open.
  return "not-verified";
};

CUSTOM_SIGNING_PREDICATES["postmark"] = postmarkSigningPredicate;

// Re-export the reachability helpers so the dedicated missing-basic-auth +
// missing-ip-allowlist predicates can share the same hint lists.
export { reachesBasicAuthRead, reachesIpAllowlistRead };
