// `hookwarden ui` handlers and `scan --format html`, against a real fixture with a
// safe automatic fix (sig === expected → crypto.timingSafeEqual).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScanCommand, type ScanArgs } from "../../src/commands/scan.js";
import { buildHandlers } from "../../src/commands/ui.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../e2e/fixtures/phase-3/stripe-timing-unsafe-fixable",
);
const TARGET = { ruleId: "stripe/timing-unsafe-comparison", file: "server.ts" };

interface Envelope {
  scan: { findings: Array<{ rule_id: string; file_path: string }> };
}

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hw-ui-"));
  await fs.cp(FIXTURE, tmp, { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ui handlers", () => {
  it("scan returns the JSON envelope", async () => {
    const env = (await buildHandlers(tmp, undefined).scan()) as Envelope;
    expect(env.scan.findings.map((f) => f.rule_id)).toContain(TARGET.ruleId);
  });

  it("preview returns the edit without touching the file", async () => {
    const before = await fs.readFile(path.join(tmp, "server.ts"), "utf-8");
    const edits = await buildHandlers(tmp, undefined).previewFix(TARGET);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      file: "server.ts",
      before: "sig === expected",
      safety: "safe",
    });
    expect(edits[0]?.after).toContain("crypto.timingSafeEqual");
    expect(await fs.readFile(path.join(tmp, "server.ts"), "utf-8")).toBe(before);
  });

  it("preview for another file returns nothing", async () => {
    expect(await buildHandlers(tmp, undefined).previewFix({ ...TARGET, file: "other.ts" })).toEqual(
      [],
    );
  });

  it("apply writes the safe edit and the finding is gone on re-scan", async () => {
    const r = await buildHandlers(tmp, undefined).applyFix(TARGET);
    expect(r.applied).toBe(1);
    expect(await fs.readFile(path.join(tmp, "server.ts"), "utf-8")).toContain(
      "crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))",
    );
    expect((r.scan as Envelope).scan.findings.map((f) => f.rule_id)).not.toContain(TARGET.ruleId);
  });
});

describe("scan --format html", () => {
  it("writes one self-contained report with the findings embedded", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
    let code: number;
    try {
      code = await runScanCommand({ path: tmp, format: "html" } as ScanArgs);
    } finally {
      spy.mockRestore();
    }
    const html = writes.join("");
    expect(code).toBe(1); // findings at the default threshold, same as every other format
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const data = html.match(
      /<script type="application\/json" id="hw-data">([\s\S]*?)<\/script>/,
    )?.[1];
    expect((JSON.parse(data ?? "{}") as Envelope).scan.findings.map((f) => f.rule_id)).toContain(
      TARGET.ruleId,
    );
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
  });
});
