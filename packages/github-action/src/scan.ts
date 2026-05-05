// GitHub Action scan orchestration.
//
// ACTION-01: same-binary invariant — invoke the bundled hookwarden CLI subprocess
// via @actions/exec. Never import @hookwarden/engine or call engine functions
// directly; the CLI is the single execution path.
//
// D-80: SARIF emission is ALWAYS the FULL head scan (no --diff-only). Code Scanning
// needs pre-existing alerts on PR-touched lines; the new-findings set used for the
// sticky comment is computed independently from the JSON envelope diff.
//
// D-86: Auto-commit baseline rejected — would require contents:write, surprises
// users on first PR, and breaks on protected main. The in-flight base-vs-head
// comparison achieves the same zero-setup goal without those costs.
//
// CLI flag invariant: Phase 4 CLI emits formatted output (text/json/sarif) to STDOUT;
// there is no --output-file flag. The Action captures stdout via @actions/exec
// listeners and writes it to a file with fs.writeFile when a path is required.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import type { ActionInputs, ActionScanOutput, ScanJsonEnvelope, SeverityCounts } from "./types.js";

const require = createRequire(import.meta.url);
const BUNDLED_HOOKWARDEN_ENTRY = require.resolve("hookwarden/dist/index.js");

interface RunCliResult {
  readonly stdout: string;
  readonly code: number;
}

async function runCli(args: ReadonlyArray<string>, cwd: string): Promise<RunCliResult> {
  let stdout = "";
  const code = await exec.exec("node", [BUNDLED_HOOKWARDEN_ENTRY, "scan", ...args], {
    cwd,
    ignoreReturnCode: true,
    env: { ...process.env, NO_COLOR: "1" },
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
    },
  });
  return { stdout, code };
}

function sumActive(counts: SeverityCounts): number {
  return counts.critical + counts.high + counts.medium + counts.low + counts.info;
}

async function gitCheckout(ref: string, cwd: string): Promise<void> {
  await exec.exec("git", ["checkout", ref], { cwd });
}

async function gitFetch(ref: string, cwd: string): Promise<void> {
  const code = await exec.exec("git", ["fetch", "origin", ref, "--depth=1000"], {
    cwd,
    ignoreReturnCode: true,
  });
  if (code !== 0) {
    core.warning(
      `git fetch origin ${ref} failed; ensure actions/checkout@v6 is configured with fetch-depth: 0`,
    );
  }
}

interface PullRequestPayload {
  readonly base: { readonly ref: string; readonly repo?: { readonly full_name: string } };
  readonly head: { readonly sha: string; readonly repo?: { readonly full_name: string } };
}

function getPullRequest(): PullRequestPayload | undefined {
  return github.context.payload["pull_request"] as PullRequestPayload | undefined;
}

function detectFork(): boolean {
  const pr = getPullRequest();
  if (pr === undefined) return false;
  const headRepo = pr.head.repo?.full_name;
  const baseRepo = pr.base.repo?.full_name;
  return headRepo !== undefined && baseRepo !== undefined && headRepo !== baseRepo;
}

function configArgs(inputs: ActionInputs): string[] {
  const out: string[] = [];
  if (inputs.configPath !== undefined) {
    out.push("--config", inputs.configPath);
  }
  if (inputs.failOn !== "") {
    out.push("--fail-on", inputs.failOn);
  }
  return out;
}

// Phase 4 D-65 exit-code precedence: 3 (config) > 2 (engine) > 4 (parse coverage)
// > 1 (findings ≥ fail-on) > 0. Codes 2/3/4 are hard errors that must surface;
// code 1 is the ACTION-04 trigger and feeds `failed: true`.
function throwOnEngineConfigOrCoverageError(code: number, label: string): void {
  if (code === 2 || code === 3 || code === 4) {
    throw new Error(`hookwarden ${label} exited with code ${code}`);
  }
}

export async function runActionScan(inputs: ActionInputs): Promise<ActionScanOutput> {
  const eventName = github.context.eventName;
  const cwd = path.resolve(inputs.workingDirectory);
  const sarifPath = path.resolve(process.env["RUNNER_TEMP"] ?? cwd, "hookwarden.sarif");
  const isFork = detectFork();

  // -------------------- non-PR path (D-85) --------------------
  if (eventName !== "pull_request") {
    const jsonRun = await runCli(["--format", "json", ...configArgs(inputs)], cwd);
    throwOnEngineConfigOrCoverageError(jsonRun.code, "non-PR JSON scan");

    // D-80: SARIF run is the FULL head scan (no --diff-only) — Code Scanning
    // shows pre-existing alerts on the default branch.
    const sarifRun = await runCli(["--format", "sarif", ...configArgs(inputs)], cwd);
    throwOnEngineConfigOrCoverageError(sarifRun.code, "non-PR SARIF emission");
    await fs.writeFile(sarifPath, sarifRun.stdout, "utf8");

    const envelope = JSON.parse(jsonRun.stdout) as ScanJsonEnvelope;
    const cliExitCode = jsonRun.code;
    return {
      findingsCount: sumActive(envelope.scan.counts.active),
      newFindingsCount: 0,
      bySeverity: envelope.scan.counts.active,
      sarifPath,
      newFindings: [],
      failed: cliExitCode === 1,
      cliExitCode,
      eventName,
      isFork: false,
    };
  }

  // -------------------- PR path (D-84) --------------------
  const pr = getPullRequest();
  if (pr === undefined) {
    throw new Error("eventName=pull_request but payload.pull_request is undefined");
  }
  const baseRef = pr.base.ref;
  const headSha = pr.head.sha;

  // 1. Fetch + checkout base, scan with full --format json to capture baseline fingerprints.
  await gitFetch(baseRef, cwd);
  await gitCheckout(`origin/${baseRef}`, cwd);
  const baseRun = await runCli(["--format", "json", ...configArgs(inputs)], cwd);
  throwOnEngineConfigOrCoverageError(baseRun.code, "base scan");
  const baseEnvelope = JSON.parse(baseRun.stdout) as ScanJsonEnvelope;
  const baseHashes = new Set<string>(
    baseEnvelope.scan.findings
      .filter((f) => f.suppressed === null)
      .map((f) => f.primary_location_line_hash),
  );

  // 2. Restore PR head, scan with --diff-only for new-findings + failure semantics.
  // D-84: composes naturally with .hookwarden.baseline.json — if the file exists in
  // cwd, the CLI auto-reads it and marks baselined findings as suppressed; the
  // !f.suppressed filter below honors that automatically.
  // D-86: auto-commit baseline REJECTED (see file header).
  await gitCheckout(headSha, cwd);
  const headRun = await runCli(["--format", "json", "--diff-only", ...configArgs(inputs)], cwd);
  throwOnEngineConfigOrCoverageError(headRun.code, "head scan");
  const headEnvelope = JSON.parse(headRun.stdout) as ScanJsonEnvelope;
  const newFindings = headEnvelope.scan.findings.filter(
    (f) => f.suppressed === null && !baseHashes.has(f.primary_location_line_hash),
  );

  // 3. SARIF emission — D-80 invariant: NO --diff-only here. Full head scan so Code
  // Scanning shows pre-existing alerts on PR-touched lines. The new-findings set
  // for the sticky comment was already computed above from the JSON envelope diff.
  const sarifRun = await runCli(["--format", "sarif", ...configArgs(inputs)], cwd);
  throwOnEngineConfigOrCoverageError(sarifRun.code, "SARIF emission");
  await fs.writeFile(sarifPath, sarifRun.stdout, "utf8");

  const cliExitCode = headRun.code;
  return {
    findingsCount: sumActive(headEnvelope.scan.counts.active),
    newFindingsCount: newFindings.length,
    bySeverity: headEnvelope.scan.counts.active,
    sarifPath,
    newFindings,
    failed: cliExitCode === 1,
    cliExitCode,
    eventName,
    isFork,
  };
}
