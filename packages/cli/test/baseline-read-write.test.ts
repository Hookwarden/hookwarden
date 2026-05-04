import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Finding, ScanResult } from "@hookwarden/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBaseline } from "../src/baseline/read.js";
import { writeBaseline } from "../src/baseline/write.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-baseline-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const validBaselineFile = {
  schema_version: "1.0",
  baselined_at: "2026-05-01T00:00:00.000Z",
  engine_version: "0.1.0",
  rule_pack_version: "0.1.0",
  rule_pack_content_hash: "sha256:abc123",
  findings: [],
} as const;

function makeFinding(hash: string, line: number, ruleId = "stripe/missing-verification"): Finding {
  return {
    id: `id-${hash}`,
    rule_id: ruleId,
    provider: "stripe",
    severity: "high",
    state: "verified",
    file_path: "src/webhook.ts",
    location: { line, col: 1, end_line: line, end_col: 10 },
    snippet: "<snippet>",
    handler_id: null,
    primary_location_line_hash: hash,
    message: "test finding",
    metadata: {},
  };
}

function makeScanResult(findings: Finding[]): ScanResult {
  return {
    findings,
    inventory: [],
    metadata: {
      engine_version: "0.1.0",
      engine_commit_sha: null,
      rule_pack_version: "0.1.0",
      rule_pack_content_hash: "sha256:abc123",
      scanned_at: "2026-05-01T00:00:00.000Z",
      parse_errors_count: 0,
      parsed_files_count: 1,
      total_files_count: 1,
      parse_candidates_count: 1,
    },
  };
}

describe("readBaseline", () => {
  it("returns null on ENOENT (no error)", async () => {
    const missing = path.join(tmp, "nope.json");
    await expect(readBaseline(missing)).resolves.toBeNull();
  });

  it("returns the parsed document for a valid baseline file", async () => {
    const f = path.join(tmp, "baseline.json");
    await fs.writeFile(f, JSON.stringify(validBaselineFile));
    await expect(readBaseline(f)).resolves.toEqual(validBaselineFile);
  });

  it("throws on malformed JSON", async () => {
    const f = path.join(tmp, "bad.json");
    await fs.writeFile(f, "{not json");
    await expect(readBaseline(f)).rejects.toThrow(/parse error/);
  });

  it("throws on JSON that fails schema validation", async () => {
    const f = path.join(tmp, "bad-schema.json");
    await fs.writeFile(f, JSON.stringify({ schema_version: "1.0" }));
    await expect(readBaseline(f)).rejects.toThrow(/validation failed/);
  });
});

describe("writeBaseline", () => {
  it("roundtrips through readBaseline to the same shape", async () => {
    const f = path.join(tmp, "baseline.json");
    const result = makeScanResult([makeFinding("hashA", 1)]);
    await writeBaseline(f, result, false);
    const reread = await readBaseline(f);
    expect(reread).not.toBeNull();
    expect(reread?.findings).toHaveLength(1);
    expect(reread?.findings[0]?.primary_location_line_hash).toBe("hashA");
  });

  it("writes findings sorted by primary_location_line_hash ascending (D-68)", async () => {
    const f = path.join(tmp, "baseline.json");
    const result = makeScanResult([
      makeFinding("hashC", 3),
      makeFinding("hashA", 1),
      makeFinding("hashB", 2),
    ]);
    await writeBaseline(f, result, false);
    const reread = await readBaseline(f);
    expect(reread?.findings.map((x) => x.primary_location_line_hash)).toEqual([
      "hashA",
      "hashB",
      "hashC",
    ]);
  });

  it("emits the D-71 stderr footgun warning when diffOnlyActive is true", async () => {
    const f = path.join(tmp, "baseline.json");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = makeScanResult([makeFinding("hashA", 1)]);
      await writeBaseline(f, result, true);
      const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.join("")).toContain(
        "warning: --baseline write under --diff-only writes a scope-narrowed baseline",
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does NOT emit the D-71 warning when diffOnlyActive is false", async () => {
    const f = path.join(tmp, "baseline.json");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = makeScanResult([makeFinding("hashA", 1)]);
      await writeBaseline(f, result, false);
      const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.join("")).not.toContain("scope-narrowed baseline");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("writes a file ending with a trailing newline", async () => {
    const f = path.join(tmp, "baseline.json");
    const result = makeScanResult([makeFinding("hashA", 1)]);
    await writeBaseline(f, result, false);
    const raw = await fs.readFile(f, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("prefixes rule_pack_content_hash with sha256: if input lacks the prefix", async () => {
    const f = path.join(tmp, "baseline.json");
    const result: ScanResult = {
      ...makeScanResult([makeFinding("hashA", 1)]),
      metadata: {
        ...makeScanResult([]).metadata,
        rule_pack_content_hash: "deadbeef",
      },
    };
    await writeBaseline(f, result, false);
    const reread = await readBaseline(f);
    expect(reread?.rule_pack_content_hash).toBe("sha256:deadbeef");
  });

  it("preserves an already-prefixed rule_pack_content_hash", async () => {
    const f = path.join(tmp, "baseline.json");
    const result = makeScanResult([makeFinding("hashA", 1)]);
    await writeBaseline(f, result, false);
    const reread = await readBaseline(f);
    expect(reread?.rule_pack_content_hash).toBe("sha256:abc123");
  });
});
