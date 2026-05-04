// CLI-11: the published severity table is asserted against the renderer's map.
// Editing one without the other fails this test in CI.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SARIF_LEVEL_BY_SEVERITY } from "../src/render/sarif.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(__dirname, "../docs/sarif-severity-mapping.md");
const HEADER = "| hookwarden severity | SARIF level | GitHub Code Scanning behavior |";

function parseTable(md: string): Record<string, string> {
  const lines = md.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim() === HEADER);
  if (headerIdx < 0) {
    throw new Error(`Doc table header not found in ${DOC_PATH}`);
  }
  const rows: Record<string, string> = {};
  // header line, then separator line, then data rows until a non-pipe line breaks the table
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length >= 2) {
      const severity = cells[0];
      const sarifLevel = cells[1];
      if (severity !== undefined && sarifLevel !== undefined) {
        rows[severity] = sarifLevel;
      }
    }
  }
  return rows;
}

describe("SARIF severity-mapping table parity (CLI-11)", () => {
  it("doc file exists and is non-empty", async () => {
    const content = await fs.readFile(DOC_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("doc table contains all 5 severities mapped per D-60", async () => {
    const content = await fs.readFile(DOC_PATH, "utf-8");
    const parsed = parseTable(content);
    expect(parsed).toEqual({
      critical: "error",
      high: "error",
      medium: "warning",
      low: "note",
      info: "note",
    });
  });

  it("doc table maps byte-for-byte to SARIF_LEVEL_BY_SEVERITY", async () => {
    const content = await fs.readFile(DOC_PATH, "utf-8");
    const parsed = parseTable(content);
    const fromDoc: Record<string, "error" | "warning" | "note"> = {};
    for (const [k, v] of Object.entries(parsed)) {
      fromDoc[k] = v as "error" | "warning" | "note";
    }
    expect(fromDoc).toEqual(SARIF_LEVEL_BY_SEVERITY);
  });
});
