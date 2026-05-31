// verify_audit_chain tool — Phase 25 Plan 25-02 (MCP-02). The SECOND tool on
// the @hookwarden/mcp stdio server: "verify the chain without trusting
// hookwarden."
//
// Accepts an evidence-pack JSON string, walks the per-row hash chain,
// roundtrips the manifest hash, and (for v1.1 packs that embed the signing
// CMK's SPKI public key) verifies the ECDSA-P256 Merkle-root + manifest
// signatures OFFLINE with node:crypto — NO AWS call, NO credentials.
//
// Crypto contract (mirrors packages/api/src/kms-client.ts signMerkleRoot +
// the offline branch of apps/docs/scripts/verify-evidence-pack.mjs in the
// private repo):
//   * The signing CMK is ECC_NIST_P256, SIGN_VERIFY, MessageType:DIGEST,
//     SigningAlgorithm:ECDSA_SHA_256, DER-encoded signature.
//   * `crypto.verify(null, digest32, { key, dsaEncoding:"der" }, derSig)`.
//     algorithm MUST be null (DIGEST mode) — the 32-byte value IS the
//     pre-hashed digest. Passing "sha256" double-hashes and always fails
//     (RESEARCH Pitfall 1). SPKI is DER, not PEM (Pitfall 2).
//
// Byte-equality anchor (D-01): canonicalize() comes from the published
// @hookwarden/canonical-json package — the SAME module the writer + worker +
// offline verifier use. The chain-walk is intentionally duplicated (not a 3rd
// published package, RESEARCH OQ#2); byte-equality is guaranteed by the
// SHARED canonicalize, not the walk.
//
// This tool is PURE CRYPTO: it must NOT import @hookwarden/engine or
// @hookwarden/rules (no AST, no rule pack, no drift gate at call time).
//
// MCP contract (D-23-08): malformed input → isError:true, NEVER throws past
// the tool boundary (a throw stops the agent loop).

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

import { canonicalize } from "@hookwarden/canonical-json";

import type { VerifyAuditChainInput, VerifyAuditChainOutput } from "../types.js";

// ── Error helper (mirrors scan-handler.ts errorResult, adapted) ─────────────
function errorResult(
  payload: Record<string, unknown> & { readonly error: string },
): VerifyAuditChainOutput {
  return {
    isError: true,
    content: [
      { type: "text", text: `hookwarden-mcp: ${payload.error}` },
      { type: "text", text: JSON.stringify(payload) },
    ],
    structuredContent: payload,
  };
}

// ── Offline ECDSA-P256 DIGEST verify ────────────────────────────────────────
// Returns true iff `derSig` is a valid ECDSA_SHA_256 signature of the 32-byte
// `digest32` under `pub`. Never throws — a malformed signature/key counts as
// "not verified" rather than crashing the verdict.
function offlineVerify(pub: KeyObject, digest32: Buffer, signatureB64: string): boolean {
  try {
    return cryptoVerify(
      null, // DIGEST mode — REQUIRED (Pitfall 1)
      digest32,
      { key: pub, dsaEncoding: "der" },
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

interface AuditRow {
  readonly seq: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly hashHex: string;
  readonly prevHashHex: string | null;
}

interface SignedBatch {
  readonly merkleRootHex: string;
  readonly signatureDerB64: string;
}

// ── Main entry ──────────────────────────────────────────────────────────────
export function verifyAuditChain(args: VerifyAuditChainInput): VerifyAuditChainOutput {
  try {
    // 1. Parse-guard. Malformed JSON → isError:true (never throw).
    let pack: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(args.evidence_pack_json);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return errorResult({
          error: "invalid_pack_json",
          message: "evidence pack must be a JSON object",
        });
      }
      pack = parsed as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult({ error: "invalid_pack_json", message });
    }

    // 2. Split the signature block (D-12-09 signed-self exclusion). The
    //    manifest hash is over packMinusSig; the signature block is appended
    //    AFTER signing and is excluded from the canonical replay.
    const { signature, ...packMinusSig } = pack as {
      signature?: Record<string, unknown>;
    } & Record<string, unknown>;
    if (signature === undefined || signature === null || typeof signature !== "object") {
      return errorResult({ error: "no_signature_block" });
    }
    const manifestHashHex =
      typeof signature["manifest_hash_hex"] === "string"
        ? (signature["manifest_hash_hex"] as string)
        : null;
    const manifestSigB64 =
      typeof signature["signature_der_b64"] === "string"
        ? (signature["signature_der_b64"] as string)
        : null;
    const spkiB64 =
      typeof signature["signing_public_key_spki_b64"] === "string"
        ? (signature["signing_public_key_spki_b64"] as string)
        : null;
    if (manifestHashHex === null || manifestSigB64 === null) {
      return errorResult({ error: "signature_block_missing_required_fields" });
    }

    // 3. Manifest roundtrip: sha256(canonicalize(pack ∖ signature)).
    const manifestDigest = createHash("sha256")
      .update(Buffer.from(canonicalize(packMinusSig), "utf8"))
      .digest();
    const manifestRoundtrips = manifestDigest.toString("hex") === manifestHashHex;

    // 4. Per-row hash chain walk over the EXACT canonical shape the writer
    //    signs: { tenantId, kind, payload, seq }. First mismatch sets
    //    broken_at_row. Signature validity is INDEPENDENT of chain integrity.
    const workspaceId = (packMinusSig as { workspace_id?: unknown })["workspace_id"];
    const auditLog = (
      packMinusSig as { scope?: { audit_log?: { rows?: unknown; signed_batches?: unknown } } }
    ).scope?.audit_log;
    const rows: ReadonlyArray<AuditRow> = Array.isArray(auditLog?.rows)
      ? (auditLog.rows as ReadonlyArray<AuditRow>)
      : [];

    let brokenAtRow: number | null = null;
    let prevHashBytes: Buffer | null = null;
    for (const row of rows) {
      const rowCanonical = Buffer.from(
        canonicalize({
          tenantId: workspaceId,
          kind: row.kind,
          payload: row.payload,
          seq: row.seq,
        }),
        "utf8",
      );
      // Genesis / prev-link assertion (mirrors verifier assertPrevLink).
      const expectedPrev =
        row.prevHashHex === null || row.prevHashHex === undefined
          ? null
          : Buffer.from(row.prevHashHex, "hex");
      const prevLinkOk =
        prevHashBytes === null
          ? expectedPrev === null
          : expectedPrev !== null && prevHashBytes.equals(expectedPrev);
      const h = createHash("sha256");
      if (prevHashBytes !== null) h.update(prevHashBytes);
      h.update(rowCanonical);
      const computed = h.digest();
      if (!prevLinkOk || computed.toString("hex") !== row.hashHex) {
        brokenAtRow = Number(row.seq);
        break;
      }
      prevHashBytes = computed;
    }

    // 5. Offline signature verification. v1.1: embedded SPKI key → verify each
    //    Merkle-root sig + the manifest sig. v1.0: no key → signatures_verified
    //    stays 0, with an explicit offline-unverifiable note (NOT a crash).
    //    A signature's validity is independent of the chain verdict.
    const signedBatches: ReadonlyArray<SignedBatch> = Array.isArray(auditLog?.signed_batches)
      ? (auditLog.signed_batches as ReadonlyArray<SignedBatch>)
      : [];
    const signaturesPresent = signedBatches.length + 1; // N roots + 1 manifest
    let signaturesVerified = 0;
    let allPresentSignaturesVerified: boolean;
    let offlineNote: string | null = null;

    if (spkiB64 !== null && spkiB64.length > 0) {
      const pub = createPublicKey({
        key: Buffer.from(spkiB64, "base64"),
        format: "der",
        type: "spki",
      });
      if (offlineVerify(pub, manifestDigest, manifestSigB64)) signaturesVerified += 1;
      for (const b of signedBatches) {
        const root = Buffer.from(b.merkleRootHex, "hex");
        if (offlineVerify(pub, root, b.signatureDerB64)) signaturesVerified += 1;
      }
      allPresentSignaturesVerified = signaturesVerified === signaturesPresent;
    } else {
      // v1.0 pack (no embedded key): signatures cannot be verified offline.
      // The chain + manifest verdict is still computed; signatures don't
      // factor into `valid` because there is nothing to verify offline.
      offlineNote = "signatures not verifiable offline (v1.0 pack)";
      allPresentSignaturesVerified = true;
    }

    // 6. valid === chain intact AND manifest roundtrips AND all present
    //    signatures verified (offline). For v1.0, the signature clause is
    //    vacuously satisfied (no embedded key → nothing to verify).
    const valid = brokenAtRow === null && manifestRoundtrips && allPresentSignaturesVerified;

    const structuredContent = {
      valid,
      broken_at_row: brokenAtRow,
      signatures_verified: signaturesVerified,
    };

    const headlineParts: string[] = [
      `hookwarden verify_audit_chain: ${valid ? "VALID" : "INVALID"}`,
      `${rows.length} audit-log row${rows.length === 1 ? "" : "s"} walked`,
      `${signaturesVerified} signature${signaturesVerified === 1 ? "" : "s"} verified offline`,
    ];
    if (brokenAtRow !== null) headlineParts.push(`chain broke at row ${brokenAtRow}`);
    if (!manifestRoundtrips) headlineParts.push("manifest hash mismatch");
    if (offlineNote !== null) headlineParts.push(offlineNote);
    const headline = `${headlineParts.join("; ")}.`;

    return {
      content: [
        { type: "text", text: headline },
        { type: "text", text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  } catch (err) {
    // D-23-08: never throw past the tool boundary.
    const message = err instanceof Error ? err.message : String(err);
    return errorResult({ error: "internal_error", message });
  }
}
