// Regression: `hookwarden scan <single-file>` must emit a correct OSC-8 file:line
// hyperlink. The bug: scan.ts used `path.resolve(args.path)` (the FILE) as the base
// for resolving repo-relative file_paths, but the pipeline anchors file_path to the
// file's PARENT dir (file_path = basename for a single-file target). resolve(<file>,
// <basename>) doubled the basename → file://…/stripe.js/stripe.js:3:1 — a broken link.
// The fix derives baseDir = dirname(target) when the target is a file.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScanCommand, type ScanArgs } from "../../src/commands/scan.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scan-link-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function captureScan(args: ScanArgs): Promise<{ out: string; code: number }> {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  try {
    const code = await runScanCommand(args);
    return { out: writes.join(""), code };
  } finally {
    spy.mockRestore();
  }
}

const VULN_STRIPE = `const express = require("express");
const app = express();
app.post("/webhooks/stripe", express.json(), (req, res) => {
  const event = req.body;
  handle(event);
  res.json({ ok: true });
});
`;

describe("scan single-file hyperlink base (file-target)", () => {
  it("emits file://<file>:line — NOT the doubled-basename broken link", async () => {
    const file = path.join(tmp, "stripe.js");
    await fs.writeFile(file, VULN_STRIPE);

    // --color always forces OSC-8 emission through the (non-TTY) test pipe.
    const { out, code } = await captureScan({ path: file, color: "always" } as unknown as ScanArgs);

    expect(code).toBe(1); // vulnerable handler → not-verified critical
    // Correct, clickable link to the actual file.
    expect(out).toContain(`file://${file}:`);
    // The bug signature: the basename appended to the full file path.
    expect(out).not.toContain(`stripe.js${path.sep}stripe.js`);
  });

  it("directory target still links correctly (no regression)", async () => {
    await fs.mkdir(path.join(tmp, "src"));
    const file = path.join(tmp, "src", "stripe.js");
    await fs.writeFile(file, VULN_STRIPE);

    const { out } = await captureScan({ path: tmp, color: "always" } as unknown as ScanArgs);
    expect(out).toContain(`file://${file}:`);
    expect(out).not.toContain(`stripe.js${path.sep}stripe.js`);
  });
});
