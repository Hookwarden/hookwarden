// Audit-shape reference-vector conformance test (T-25-01 mitigation).
//
// Pins the canonical bytes of the two integrity-critical hookwarden
// consumer shapes so any future change to this package is caught
// against the live writer + export-worker expectations:
//
//   1. The audit-log row shape {tenantId, kind, payload, seq} —
//      verbatim from packages/api/src/audit-log/writer.ts (the
//      sha256(prev_hash || canonicalize(row)) hash-chain input).
//   2. The pack-minus-signature shape —
//      verbatim from packages/worker/src/jobs/evidence-pack-export.ts
//      (the sha256(canonicalize(packMinusSignature)) manifest digest
//      the auditor's offline verifier replays).
//
// Both shapes' canonical bytes ARE the hash/Merkle input — byte-drift
// silently breaks every audit-log chain check and evidence-pack
// signature replay. The expected bytes live as `.bin` fixtures under
// test/fixtures/ (biome-excluded, never reformatted). The comparison is
// byte-level (Buffer.equals), not JS-string-level: JCS specifies a UTF-8
// byte sequence and an encoding mismatch would be invisible at the
// string layer.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "fixtures");

// Audit-log row — packages/api/src/audit-log/writer.ts:384. seq is wired
// as a string (JCS throws on bigint per the 07-02 canonical-json
// contract; the writer does seq.toString()).
const AUDIT_ROW = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  kind: "evidence_pack_exported",
  payload: {
    actor_user_id: "22222222-2222-2222-2222-222222222222",
    pack_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    manifest_hash_hex: "d1e8b0b18ae3",
  },
  seq: "42",
} as const;

// Pack-minus-signature — packages/worker/src/jobs/evidence-pack-export.ts:355.
// snake_case wire keys are load-bearing (the auditor replays this exact
// shape). Audit-log seq values are strings (loader does the bigint →
// string conversion). The signature block is appended AFTER canonicalize,
// so it is excluded here (D-12-09 signed-self exclusion).
const PACK_MINUS_SIGNATURE = {
  schema_version: "1.0",
  pack_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  exported_at: "2026-05-29T12:00:00.000Z",
  workspace_id: "11111111-1111-1111-1111-111111111111",
  scope: {
    endpoints: [
      {
        id: "ep-1",
        provider: "stripe",
        framework: "hono",
        routePattern: "/webhooks/stripe",
        filePath: "src/webhooks/stripe.ts",
        verificationStatus: "verified",
      },
    ],
    rotations: [],
    leaks: [],
    findings: [],
    audit_log: {
      rows: [
        {
          seq: "1",
          kind: "workspace_provisioned",
          payload: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          hashHex: "ab",
          prevHashHex: null,
        },
      ],
      signed_batches: [],
    },
  },
  soc2_mapping: { "CC6.1": [], "CC6.7": [], "CC7.1": [] },
  iso27001_mapping: { "A.5.17": [], "A.8.24": [] },
} as const;

describe("audit-shape reference vectors: hookwarden consumer byte-equality", () => {
  it("canonicalize(audit-log row) matches the writer.ts known-good bytes", () => {
    const expected = readFileSync(join(FIXTURES_DIR, "audit-row.canonical.bin"));
    const actual = Buffer.from(canonicalize(AUDIT_ROW), "utf8");
    expect(actual.equals(expected)).toBe(true);
  });

  it("canonicalize(pack-minus-signature) matches the export-worker known-good bytes", () => {
    const expected = readFileSync(join(FIXTURES_DIR, "pack-minus-signature.canonical.bin"));
    const actual = Buffer.from(canonicalize(PACK_MINUS_SIGNATURE), "utf8");
    expect(actual.equals(expected)).toBe(true);
  });

  it("sorts object keys by UTF-16 code unit regardless of insertion order", () => {
    // Re-ordering the input keys MUST NOT change the canonical bytes —
    // this is the property the hash-chain relies on across language /
    // serializer boundaries.
    const reordered = {
      seq: AUDIT_ROW.seq,
      payload: AUDIT_ROW.payload,
      tenantId: AUDIT_ROW.tenantId,
      kind: AUDIT_ROW.kind,
    };
    const expected = readFileSync(join(FIXTURES_DIR, "audit-row.canonical.bin"));
    const actual = Buffer.from(canonicalize(reordered), "utf8");
    expect(actual.equals(expected)).toBe(true);
  });
});
