// Phase 8.5 (DISCORD-01) — Discord Ed25519 verify recognition.
//
// Predicate-level proof across all 4 verify mechanisms (verifyKey / nacl / PyNaCl / PHP sodium) plus
// the mandatory negatives (SOC2 evidence per [[feedback_negative_tests_required]]): a PING-only
// handler with no verify → not-verified, and the import-without-use FP guard (verifyKey imported but
// never CALLED → still not-verified). Catalog assertions cover SC#3 + the namespaced-path
// contamination guard ([[project_provider_catalog_conventional_paths]]).

import type { WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "../src/catalog.js";
import {
  discordHasEd25519Verify,
  discordLibraryVerifiedPredicate,
  discordMissingVerificationPredicate,
} from "../src/predicates/discord-ed25519.js";

function makeHandler(overrides: Partial<WebhookHandler>): WebhookHandler {
  return {
    id: "h",
    framework: "express",
    framework_version: null,
    route_pattern: "/api/discord/interactions",
    http_methods: ["POST"],
    file_path: "src/interactions.ts",
    location: { line: 1, col: 1, end_line: 2, end_col: 1 },
    handler_function_name: "handler",
    provider: "discord",
    verification_state: "manual-review",
    evidence: [],
    middleware_chain: [],
    reachable_symbols: [],
    findings_ref: [],
    redacted_snippet: "",
    ...overrides,
  };
}

function reachable(qn: string) {
  return [{ qualified_name: qn, import_source: null, hops: 1, via: "direct call" }];
}

describe("discordHasEd25519Verify — positive across 4 mechanisms", () => {
  it("JS verifyKey (reachable) → true", () => {
    expect(
      discordHasEd25519Verify(makeHandler({ reachable_symbols: reachable("verifyKey") })),
    ).toBe(true);
  });
  it("JS nacl.sign.detached.verify (reachable) → true", () => {
    expect(
      discordHasEd25519Verify(
        makeHandler({ reachable_symbols: reachable("nacl.sign.detached.verify") }),
      ),
    ).toBe(true);
  });
  it("Python VerifyKey.verify (reachable) → true", () => {
    expect(
      discordHasEd25519Verify(
        makeHandler({ reachable_symbols: reachable("key.VerifyKey.verify") }),
      ),
    ).toBe(true);
  });
  it("PHP sodium_crypto_sign_verify_detached (inline snippet call) → true", () => {
    expect(
      discordHasEd25519Verify(
        makeHandler({
          framework: "laravel",
          redacted_snippet:
            "if (!sodium_crypto_sign_verify_detached($sig, $msg, $key)) { abort(401); }",
        }),
      ),
    ).toBe(true);
  });
  it("sdk_verify_call evidence (provider discord) → true", () => {
    expect(
      discordHasEd25519Verify(
        makeHandler({
          evidence: [
            {
              kind: "sdk_verify_call",
              provider: "discord",
              location: { line: 3, col: 1, end_line: 3, end_col: 9 },
              detail: "verifyKey",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("discordHasEd25519Verify — NEGATIVE (FP guards)", () => {
  it("no verify anywhere → false", () => {
    expect(discordHasEd25519Verify(makeHandler({}))).toBe(false);
  });
  it("import-without-use: verifyKey imported but never CALLED → false", () => {
    // The import line has `verifyKey` but NOT `verifyKey(` — and it is not in reachable_symbols
    // (reachable symbols are calls, not imports). Must not falsely register as verified.
    expect(
      discordHasEd25519Verify(
        makeHandler({
          redacted_snippet:
            "import { verifyKey } from 'discord-interactions';\nreturn res.send({ type: 1 });",
        }),
      ),
    ).toBe(false);
  });
});

describe("discord predicates — verdict + provider gate", () => {
  it("library-verified emits verified when a verify call is present", async () => {
    const v = await discordLibraryVerifiedPredicate(
      makeHandler({ reachable_symbols: reachable("verifyKey") }),
      {} as never,
    );
    expect(v).toBe("verified");
  });
  it("missing-verification emits not-verified for a PING-only handler", async () => {
    const v = await discordMissingVerificationPredicate(makeHandler({}), {} as never);
    expect(v).toBe("not-verified");
  });
  it("both predicates return null for a non-discord handler (provider gate)", async () => {
    const stripe = makeHandler({ provider: "stripe", reachable_symbols: reachable("verifyKey") });
    expect(await discordLibraryVerifiedPredicate(stripe, {} as never)).toBeNull();
    expect(await discordMissingVerificationPredicate(stripe, {} as never)).toBeNull();
  });
});

describe("discord catalog entry (SC#3 + contamination guard)", () => {
  const discord = PROVIDER_CATALOG["discord"];
  it("is an ed25519 asymmetric provider with the 4 verify calls + hex public key", () => {
    expect(discord?.signature_scheme).toBe("ed25519");
    expect(discord?.public_key_encoding).toBe("hex");
    expect(discord?.asymmetric_verify_calls).toEqual([
      "verifyKey",
      "nacl.sign.detached.verify",
      "VerifyKey.verify",
      "sodium_crypto_sign_verify_detached",
    ]);
  });
  it("conventional_paths are NAMESPACED — never bare /interactions", () => {
    const paths = discord?.conventional_paths ?? [];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).not.toContain("/interactions");
    for (const p of paths) {
      expect(p.startsWith("/api/") || p.startsWith("/discord/")).toBe(true);
    }
  });
});
