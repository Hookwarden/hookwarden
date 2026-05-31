// Plan 25-02 (MCP-02) — verify_audit_chain tool tests: 1 happy path + 3
// negatives (tampered row, v1.0 no-key, malformed JSON).
//
// The v1.1 fixture is a real ECDSA-P256-signed evidence pack (the SPKI public
// key + DER signatures are genuine, produced by the worker's signing path);
// it has 1 signed Merkle batch + 1 manifest signature → signatures_verified:2
// on the happy path. The v1.0 fixture has no embedded key and a synthetic
// (offline-unverifiable) signature → signatures_verified:0.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { verifyAuditChain } from "../../src/tools/verify-audit-chain.js";
import type { VerifyAuditChainStructuredContent } from "../../src/types.js";

function fixture(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function structured(
  result: ReturnType<typeof verifyAuditChain>,
): VerifyAuditChainStructuredContent {
  return result.structuredContent as VerifyAuditChainStructuredContent;
}

describe("verify_audit_chain (MCP-02)", () => {
  it("Test 1 (happy path): valid v1.1 pack → { valid:true, broken_at_row:null, signatures_verified:2 }", () => {
    const result = verifyAuditChain({ evidence_pack_json: fixture("evidence-pack-v1-1.json") });
    expect(result.isError).toBeUndefined();
    const sc = structured(result);
    expect(sc.valid).toBe(true);
    expect(sc.broken_at_row).toBeNull();
    // N (1 Merkle root) + 1 manifest = 2 signatures verified offline.
    expect(sc.signatures_verified).toBe(2);
  });

  it("Test 2 (negative — tampered row): chain breaks at the mutated row's seq; signatures still count", () => {
    const pack = JSON.parse(fixture("evidence-pack-v1-1.json"));
    // Mutate row 2's payload so its canonical bytes (and thus chain hash) no
    // longer match the stored hashHex → chain breaks at seq=2. The
    // Merkle-root signature is over the stored merkleRootHex (unaltered) so it
    // STILL verifies; the manifest signature is over the whole pack body
    // (which now contains the tampered row) so it NO LONGER verifies. Net:
    // 1 signature still verifies. Signature validity is independent of the
    // chain verdict (the broken chain is detected by broken_at_row, not by
    // the signature count).
    pack.scope.audit_log.rows[1].payload.rotation_id = "TAMPERED-rot-id";
    const result = verifyAuditChain({ evidence_pack_json: JSON.stringify(pack) });
    expect(result.isError).toBeUndefined();
    const sc = structured(result);
    expect(sc.valid).toBe(false);
    expect(sc.broken_at_row).toBe(2);
    // The Merkle-root sig still verifies (root digest unaltered); the manifest
    // sig fails (pack body changed). 1 of 2 present signatures verifies.
    expect(sc.signatures_verified).toBe(1);
  });

  it("Test 3 (negative — v1.0 no key): signatures_verified:0 + offline-unverifiable note, no crash, no isError", () => {
    const result = verifyAuditChain({ evidence_pack_json: fixture("evidence-pack-v1-0.json") });
    expect(result.isError).toBeUndefined();
    const sc = structured(result);
    // No embedded key → nothing to verify offline; chain + manifest still
    // computed. The v1.0 fixture's chain + manifest are intact → valid:true.
    expect(sc.signatures_verified).toBe(0);
    expect(sc.broken_at_row).toBeNull();
    expect(sc.valid).toBe(true);
    const note = result.content.map((c) => c.text).join(" ");
    expect(note).toContain("signatures not verifiable offline");
  });

  it("Test 4 (negative — malformed JSON): isError:true, never throws past the boundary", () => {
    const result = verifyAuditChain({ evidence_pack_json: "{ not json ::: }" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toBe("invalid_pack_json");
    // The error message surfaces the parse failure detail.
    expect((result.structuredContent as { message?: string }).message).toBeTypeOf("string");
  });
});
