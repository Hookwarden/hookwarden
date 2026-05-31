// Cross-language conformance test against the cyberphone/json-canonicalization
// reference implementation. Vectors are bundled verbatim under
// ./cyberphone-vectors/ — see ./cyberphone-vectors/UPSTREAM.md for the
// upstream pin and refresh procedure.
//
// L3 from the 2026-05-17 security review of plan 07-03. Proves the
// encoder agrees byte-for-byte with the de-facto reference, which is the
// EVIDENCE-03 contract for auditor evidence packs: a verifier in any
// language using a JCS implementation must produce the same canonical
// bytes as our writer.
//
// The comparison is byte-level (not JS-string-level). JCS produces a
// UTF-8 byte sequence; we encode our output and the upstream reference
// to UTF-8 buffers and assert equality.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = join(HERE, "cyberphone-vectors");

const NAMES = ["arrays", "french", "structures", "unicode", "values", "weird"] as const;

describe("cross-language conformance: cyberphone JCS reference vectors", () => {
  for (const name of NAMES) {
    it(`canonicalize(${name}.json) matches the upstream reference output byte-for-byte`, () => {
      const inputBytes = readFileSync(join(VECTORS_DIR, "input", `${name}.json`));
      const expectedBytes = readFileSync(join(VECTORS_DIR, "output", `${name}.json`));

      // Parse the input as UTF-8 JSON — this is the one place JSON.parse
      // is allowed in the package (the parse side is not part of the
      // canonical encoder; D-19 only forbids JSON.stringify).
      const parsed = JSON.parse(inputBytes.toString("utf8")) as unknown;
      const actualString = canonicalize(parsed);
      const actualBytes = Buffer.from(actualString, "utf8");

      // Compare as byte buffers, not strings — JCS specifies a byte
      // sequence and a mismatch in encoding would be invisible at the
      // JS-string layer.
      expect(actualBytes.equals(expectedBytes)).toBe(true);
    });
  }
});
