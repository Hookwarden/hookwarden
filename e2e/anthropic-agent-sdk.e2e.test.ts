// Phase 25 (AGENT-02) filesystem-level proof for the Anthropic Agent SDK agentic-callback ruleset.
//
// These tests run the REAL CLI in-process (`main(argv)`) against the fixture pair under
// e2e/fixtures/anthropic-agent-sdk/ and assert the rendered JSON. They are the end-to-end
// counterpart to the rule-level unit tests in packages/rules/test: where those inject evidence
// directly, these drive the whole walk → discover the @anthropic-ai/claude-agent-sdk service →
// engine content-sniff (sdk_packages import + webhookish route) → evaluate → render chain.
//
// Critically applies [[project_e2e_fixture_detection_gotcha]]: a fixture that does not
// content-sniff as anthropic-agent-sdk is silently NOT scanned, and the test "passes" with zero
// findings while proving nothing. Every assertion below first checks that the fixture was
// DETECTED (an anthropic-agent-sdk handler appears in the inventory) before asserting counts.
//
// SC#1 — unverified-tool-callback fires the named critical detector tool-callback-no-verification.
// SC#2 — verified-tool-callback emits ZERO anthropic-agent-sdk/* findings (HMAC-verified shape).

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../packages/cli/src/index.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/anthropic-agent-sdk",
);

interface Captured {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function captureStdout(fn: () => Promise<number>): Promise<Captured> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  // biome-ignore lint/suspicious/noExplicitAny: replacing stream method for test capture
  (process.stdout.write as any) = (chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  // biome-ignore lint/suspicious/noExplicitAny: replacing stream method for test capture
  (process.stderr.write as any) = (chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    const exitCode = await fn();
    return { exitCode, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: restoring original stream method
    (process.stdout.write as any) = origStdout;
    // biome-ignore lint/suspicious/noExplicitAny: restoring original stream method
    (process.stderr.write as any) = origStderr;
  }
}

interface FindingPayload {
  readonly rule_id: string;
  readonly severity: string;
  readonly state: string;
  readonly file_path: string;
}

interface HandlerPayload {
  readonly framework: string;
  readonly provider: string;
}

interface ScanEnvelope {
  readonly scan: {
    readonly findings: ReadonlyArray<FindingPayload>;
    readonly inventory: ReadonlyArray<HandlerPayload>;
    readonly parse_errors_count: number;
  };
}

async function scanFixtureJson(dir: string): Promise<ScanEnvelope> {
  const out = await captureStdout(() =>
    main(["scan", path.join(FIXTURE_ROOT, dir), "--format", "json", "--verbose"]),
  );
  return JSON.parse(out.stdout) as ScanEnvelope;
}

let savedNoColor: string | undefined;
beforeEach(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe("Phase 25 (AGENT-02) — Anthropic Agent SDK agentic-callback ruleset, filesystem E2E", () => {
  it("SC#1: unverified-tool-callback is detected as anthropic-agent-sdk AND fires tool-callback-no-verification", async () => {
    const env = await scanFixtureJson("unverified-tool-callback");

    // Detection gate FIRST (fixture-detection gotcha): the handler must be content-detected as
    // anthropic-agent-sdk (sdk_packages import sniff), otherwise the findings count is vacuous.
    const handlers = env.scan.inventory.filter((h) => h.provider === "anthropic-agent-sdk");
    expect(
      handlers.length,
      "unverified fixture was not content-detected as anthropic-agent-sdk (no handler in inventory)",
    ).toBeGreaterThanOrEqual(1);
    expect(handlers.some((h) => h.framework === "express")).toBe(true);

    const findings = env.scan.findings.filter((f) => f.rule_id.startsWith("anthropic-agent-sdk/"));
    expect(findings.length).toBeGreaterThanOrEqual(1);

    // Named detector — critical severity. The VAS-01 machinery ships at manual-review state
    // (the conservative cross-cutting verdict; Planning Risk A1).
    const named = findings.find(
      (f) => f.rule_id === "anthropic-agent-sdk/tool-callback-no-verification",
    );
    expect(named, "named detector tool-callback-no-verification did not fire").toBeDefined();
    expect(named?.severity).toBe("critical");
    expect(named?.state).toBe("manual-review");
    expect(named?.file_path).toMatch(/server\.ts$/);
  });

  it("SC#2: verified-tool-callback is detected as anthropic-agent-sdk but emits ZERO anthropic-agent-sdk/* findings", async () => {
    const env = await scanFixtureJson("verified-tool-callback");

    // Detection gate FIRST — the mitigated fixture MUST still be scanned (otherwise "zero
    // findings" is meaningless). The handler is content-detected as anthropic-agent-sdk.
    const handlers = env.scan.inventory.filter((h) => h.provider === "anthropic-agent-sdk");
    expect(
      handlers.length,
      "mitigated fixture was not content-detected as anthropic-agent-sdk — 'zero findings' would be vacuous",
    ).toBeGreaterThanOrEqual(1);

    const findings = env.scan.findings.filter((f) => f.rule_id.startsWith("anthropic-agent-sdk/"));
    expect(
      findings,
      `mitigated fixture must emit ZERO anthropic-agent-sdk/* findings, got: ${findings.map((f) => f.rule_id).join(", ")}`,
    ).toEqual([]);
  });
});
