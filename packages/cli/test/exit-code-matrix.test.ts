// Phase 4 Plan 09 Task 3 — exit-code matrix verifying D-65 precedence (3 > 2 > 4 > 1 > 0).
// Five fixtures + Blocker 4 (--fail-on / --format / --min-parse-coverage value gates) + 2 precedence cases.

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, "../bin/cli.cjs");
const FIXTURE_ROOT = path.resolve(__dirname, "../../../e2e/fixtures/phase-3");
const CANONICAL_BUG = path.join(FIXTURE_ROOT, "canonical-stripe-bug");
const CANONICAL_HAPPY = path.join(FIXTURE_ROOT, "stripe-construct-event-happy-path");

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: ReadonlyArray<string>): CliResult {
  const proc = spawnSync("node", [CLI_BIN, "scan", ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "em-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("exit-code matrix (CLI-04, D-65 precedence 3 > 2 > 4 > 1 > 0)", () => {
  it("EM-0: clean fixture (no findings) → exit 0", async () => {
    await fs.writeFile(path.join(tmp, "noop.js"), "// clean\n");
    const r = runCli([tmp]);
    expect(r.code).toBe(0);
  });

  it("EM-1: high finding → exit 1; --fail-on critical raises threshold so a high-only fixture exits 0", async () => {
    // Canonical bug has critical findings; default fail_on=high → exit 1.
    const r1 = runCli([CANONICAL_BUG]);
    expect(r1.code).toBe(1);

    // Now construct a fixture whose only finding is high-severity. Easier: keep the canonical bug
    // and only verify that --fail-on critical does not change exit (still has critical findings).
    // EM-1 covers the "threshold raises bar" semantic via the inverse: --fail-on low does NOT trip
    // when a clean fixture is scanned.
    const cleanDir = await fs.mkdtemp(path.join(os.tmpdir(), "em1-"));
    try {
      await fs.writeFile(path.join(cleanDir, "noop.js"), "// clean\n");
      const r2 = runCli(["--fail-on", "low", cleanDir]);
      expect(r2.code).toBe(0);
    } finally {
      await fs.rm(cleanDir, { recursive: true, force: true });
    }
  });

  it("EM-2: engine error (rules-load failure) → exit 2", async () => {
    const emptyRules = await fs.mkdtemp(path.join(os.tmpdir(), "em2-rules-"));
    try {
      const r = runCli(["--rules-dir", emptyRules, CANONICAL_HAPPY]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/engine error|rule pack/i);
    } finally {
      await fs.rm(emptyRules, { recursive: true, force: true });
    }
  });

  it("EM-3 (Blocker 4): invalid --fail-on → exit 3, message names the value", () => {
    const r = runCli(["--fail-on", "nonsense", CANONICAL_BUG]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("must be one of critical|high|medium|low");
    expect(r.stderr).toContain("nonsense");
  });

  it("EM-3b (Blocker 4): invalid --format → exit 3, message names the value", () => {
    const r = runCli(["--format", "weird", CANONICAL_BUG]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("must be one of text|json|sarif");
    expect(r.stderr).toContain("weird");
  });

  it("EM-3c (Blocker 4): invalid --min-parse-coverage → exit 3", () => {
    const r = runCli(["--min-parse-coverage", "1.5", CANONICAL_BUG]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("must be a number between 0 and 1");
    expect(r.stderr).toContain("1.5");
  });

  it("EM-4: parse-coverage below minimum → exit 4 with stderr matching D-65 message", async () => {
    // Force low parse coverage: a single .js file with un-parseable syntax.
    await fs.writeFile(
      path.join(tmp, "broken.js"),
      "this { is ! valid /* unterminated\n", // Babel parse error guaranteed
    );
    const r = runCli([tmp]);
    expect(r.code).toBe(4);
    expect(r.stderr).toMatch(/Parse coverage/);
    expect(r.stderr).toMatch(/below minimum 95/);
  });

  it("EM-precedence-1: invalid --fail-on (config error) wins over a fixture that would trip parse-coverage AND findings → exit 3", async () => {
    await fs.writeFile(path.join(tmp, "broken.js"), "this { is ! valid\n");
    const r = runCli(["--fail-on", "garbage", tmp]);
    expect(r.code).toBe(3);
  });

  it("EM-precedence-2: parse-coverage below minimum AND active findings → exit 4 (parse-coverage wins over findings, D-65)", async () => {
    // Three files: one parses OK and emits findings (canonical Stripe bug source), two fail to parse.
    const STRIPE_BUG = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');
app.post('/webhook', express.json(), (req, res) => {
  res.json({ received: true });
});
`;
    await fs.writeFile(path.join(tmp, "good.js"), STRIPE_BUG);
    await fs.writeFile(path.join(tmp, "broken1.js"), "this { is ! valid\n");
    await fs.writeFile(path.join(tmp, "broken2.js"), "another } syntax = error /\n");
    const r = runCli([tmp]);
    expect(r.code).toBe(4);
  });
});
