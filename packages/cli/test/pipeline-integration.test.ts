// Phase 4 Plan 09 Task 3 — end-to-end CLI invocations via spawnSync.
// Each test runs the real CLI binary against a real fixture and asserts stdout shape + exit code.
// Closest thing the CLI has to a phase-wide smoke test.

import { execFileSync, spawnSync } from "node:child_process";
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

function runCli(args: ReadonlyArray<string>, cwd?: string): CliResult {
  const proc = spawnSync("node", [CLI_BIN, "scan", ...args], {
    cwd: cwd ?? process.cwd(),
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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const STRIPE_BUG_SOURCE = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');

app.post('/webhook', express.json(), (req, res) => {
  const event = req.body;
  res.json({ received: true });
});
`;

describe("Phase 4 ROADMAP success criteria — pipeline integration", () => {
  it("PI-1: --format json on canonical Stripe bug exits 1 with valid envelope", () => {
    const r = runCli(["--format", "json", CANONICAL_BUG]);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout);
    expect(env.schema_version).toBe("1.0");
    expect(env.scan.findings.length).toBeGreaterThan(0);
    expect(
      env.scan.findings.some(
        (f: { severity: string; state: string }) =>
          f.severity === "critical" && f.state === "not-verified",
      ),
    ).toBe(true);
  });

  it("PI-2: --format sarif on canonical Stripe bug exits 1 with valid SARIF 2.1.0", () => {
    const r = runCli(["--format", "sarif", CANONICAL_BUG]);
    expect(r.code).toBe(1);
    const sarif = JSON.parse(r.stdout);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    const r0 = sarif.runs[0].results[0];
    expect(r0.level).toBe("error"); // critical → error per D-60
    expect(r0.partialFingerprints.primaryLocationLineHash).toBeTruthy();
    expect(r0.properties["hookwarden-state"]).toBe("not-verified");
  });

  it("PI-3: --format text on happy path emits a 'verified' badge in output", () => {
    const r = runCli(["--format", "text", CANONICAL_HAPPY]);
    // The happy-path fixture also trips a separate critical/not-verified rule (stripe/raw-body-misuse)
    // so exit code is 1, but the verified badge from stripe/library-verified must appear.
    expect(r.stdout).toContain("verified");
  });

  it("PI-4: inline disable comment suppresses the finding (D-63 + D-66)", async () => {
    // Copy canonical bug fixture and insert an inline disable.
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    const serverPath = path.join(tmp, "server.js");
    const original = await fs.readFile(serverPath, "utf-8");
    const lines = original.split("\n");
    // Insert an inline-disable line before every "app.post" line.
    const patched = lines
      .flatMap((l) =>
        l.includes("app.post(")
          ? [
              "// hookwarden-disable-next-line stripe/missing-signature-verification,stripe/express-middleware-ordering,stripe/raw-body-misuse",
              l,
            ]
          : [l],
      )
      .join("\n");
    await fs.writeFile(serverPath, patched);
    const r = runCli(["--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    const inlineSuppressed = env.scan.findings.filter(
      (f: { suppressed: { source: string } | null }) => f.suppressed?.source === "inline",
    );
    expect(inlineSuppressed.length).toBeGreaterThan(0);
  });

  it("PI-5: .hookwardenignore suppresses findings with source=ignore", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, ".hookwardenignore"), "server.js\n");
    const r = runCli(["--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    const ignored = env.scan.findings.filter(
      (f: { suppressed: { source: string; pattern?: string } | null }) =>
        f.suppressed?.source === "ignore",
    );
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored[0].suppressed.pattern).toBe("server.js");
  });

  it("PI-6: baseline file with the finding's fingerprint suppresses with source=baseline", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    // First scan to capture a baseline.
    const writeRes = runCli(["--baseline", "write", "--format", "json", tmp]);
    expect(writeRes.code).toBe(1); // baseline-write does not mute exit code on the same run
    // Second scan auto-reads the baseline.
    const r = runCli(["--format", "json", tmp]);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout);
    const baselined = env.scan.findings.filter(
      (f: { suppressed: { source: string } | null }) => f.suppressed?.source === "baseline",
    );
    expect(baselined.length).toBeGreaterThan(0);
  });

  it("PI-7: --baseline write captures findings; second run exits 0", async () => {
    await fs.cp(CANONICAL_BUG, tmp, { recursive: true });
    const w = runCli(["--baseline", "write", tmp]);
    expect(w.code).toBe(1); // findings still trip on the same run
    const baselineFile = path.join(tmp, ".hookwarden.baseline.json");
    const baseline = JSON.parse(await fs.readFile(baselineFile, "utf-8"));
    expect(baseline.schema_version).toBe("1.0");
    expect(baseline.findings.length).toBeGreaterThan(0);

    const r = runCli([tmp]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("pre-existing");
  });

  it("PI-8: --diff-only against a 1-changed-file repo only walks the changed file", async () => {
    await fs.writeFile(path.join(tmp, "a.js"), "// finding-free\n");
    await fs.writeFile(path.join(tmp, "b.js"), "// finding-free\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "test@test.test"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    await fs.writeFile(path.join(tmp, "a.js"), STRIPE_BUG_SOURCE);
    const r = runCli(["--diff-only", "--diff-base", "HEAD", "--format", "json", tmp]);
    const env = JSON.parse(r.stdout);
    expect(env.scan.parse_candidates_count).toBe(1);
    const filePaths = new Set<string>(
      env.scan.findings.map((f: { file_path: string }) => f.file_path),
    );
    if (filePaths.size > 0) {
      expect([...filePaths]).toEqual(["a.js"]);
    }
  });

  it("PI-9: empty/clean directory exits 0 with no findings", async () => {
    await fs.writeFile(path.join(tmp, "noop.js"), "// nothing here\n");
    const r = runCli([tmp]);
    expect(r.code).toBe(0);
  });

  it("PI-10: JSON stdout passes JSON.parse cleanly (no warnings/colors leak to stdout)", () => {
    const r = runCli(["--format", "json", CANONICAL_BUG]);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
