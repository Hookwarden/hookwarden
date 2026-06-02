// Phase 8.5 (DISCORD-01) — Ed25519 verify recognition for Discord interactions handlers.
//
// Discord is the first asymmetric provider (verified against the app PUBLIC key, not a shared HMAC
// secret). A handler counts as VERIFIED when it reaches any of the Ed25519 verify calls:
//   - JS/TS:  `verifyKey` (discord-interactions-js), `nacl.sign.detached.verify` (tweetnacl)
//   - Python: `nacl.signing.VerifyKey(...).verify(...)` (PyNaCl)
//   - PHP:    `sodium_crypto_sign_verify_detached(...)` (libsodium, a bare global function)
//
// Detection paths (gated to provider === "discord", so this never contaminates other providers):
//   A. reachable_symbols — JS/TS + Python cross-file (engine D-34 reachability).
//   B. sdk_verify_call evidence — provider discord (the build.ts overlay emits these for the
//      catalog `sdk_verify_calls` in JS/Python).
//   C. handler snippet markers — inline calls in ANY language, incl. the PHP bare global
//      `sodium_crypto_sign_verify_detached` which the shared PHP overlay (`::`/`\` shapes only)
//      does not emit. Markers are distinctive (no generic "verify") so the snippet scan is safe.
//
// Pure: no fs/http/network/process/node:*. Receives WebhookHandler + ProjectModel; returns Verdict|null.

import type { ProjectModel, RulePredicate, WebhookHandler } from "@hookwarden/engine";
import { PROVIDER_CATALOG } from "../catalog.js";

const DISCORD_VERIFY_CALLS: ReadonlyArray<string> =
  PROVIDER_CATALOG["discord"]?.asymmetric_verify_calls ?? [];

// Distinctive inline CALL markers for Path C — note the trailing `(`: we require an actual call,
// not a bare identifier, so an `import { verifyKey }` that is never invoked does NOT match
// (the import-without-use false positive the plan calls out). A generic bare "verify" is excluded.
const SNIPPET_MARKERS: ReadonlyArray<string> = [
  "verifyKey(",
  "sodium_crypto_sign_verify_detached(",
  "detached.verify(",
  "VerifyKey(",
];

// Exported for direct unit testing (mirrors the existing predicate test-helper export pattern).
export function discordHasEd25519Verify(handler: WebhookHandler): boolean {
  // Path A — reachable symbols (JS/TS + Python).
  for (const sym of handler.reachable_symbols) {
    for (const call of DISCORD_VERIFY_CALLS) {
      if (sym.qualified_name === call || sym.qualified_name.endsWith(`.${call}`)) return true;
    }
  }
  // Path B — sdk_verify_call evidence attributed to discord.
  for (const ev of handler.evidence) {
    if (ev.kind === "sdk_verify_call" && ev.provider === "discord") return true;
  }
  // Path C — inline snippet markers (covers PHP sodium + any inline call missed by A/B).
  for (const marker of SNIPPET_MARKERS) {
    if (handler.redacted_snippet.includes(marker)) return true;
  }
  return false;
}

// Positive short-circuit: a Discord handler that performs Ed25519 verification → verified.
export const discordLibraryVerifiedPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "discord") return null;
  return discordHasEd25519Verify(handler) ? "verified" : null;
};

// A Discord interactions handler with NO Ed25519 verification reachable → not-verified.
export const discordMissingVerificationPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.provider !== "discord") return null;
  return discordHasEd25519Verify(handler) ? null : "not-verified";
};
