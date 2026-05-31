// Phase 24 (AGENT-01) filesystem-level proof for the n8n agentic-callback ruleset.
//
// These tests run the REAL CLI in-process (`main(argv)`) against the Talos fixture corpus under
// e2e/fixtures/n8n/ and assert the rendered JSON. They are the end-to-end counterpart to the
// rule-level unit tests in packages/rules/test/n8n-rules.test.ts: where those inject evidence
// directly, these drive the whole walk → discover *.workflow.json + package.json#n8n.nodes →
// engine content-sniff → synthetic handler + webhook() detector → evaluate → render chain.
//
// Critically applies [[project_e2e_fixture_detection_gotcha]]: a fixture that does not
// content-sniff as n8n is silently NOT scanned, and the test "passes" with zero findings while
// proving nothing. Every assertion below first checks that the fixture was DETECTED (the n8n
// handlers appear in the inventory) before asserting finding counts.
//
// SC#1 — talos-attack-surface emits >=2 n8n/* findings (critical trigger + high TS handler).
// SC#2 — talos-mitigated emits ZERO n8n/* findings.
// Negative — the malformed workflow JSON surfaces a parse-error finding (never a silent drop or
//            crash), per [[feedback_negative_tests_required]] + T-24-13.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../packages/cli/src/index.js";

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/n8n");

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

describe("Phase 24 (AGENT-01) — n8n agentic-callback ruleset, filesystem E2E", () => {
  it("SC#1: talos-attack-surface is detected as n8n AND emits >=2 n8n/* findings (critical trigger + high TS handler)", async () => {
    const env = await scanFixtureJson("talos-attack-surface");

    // Detection gate FIRST (fixture-detection gotcha): both n8n handlers must be in the inventory,
    // otherwise the findings count is vacuous.
    const n8nHandlers = env.scan.inventory.filter((h) => h.provider === "n8n");
    expect(
      n8nHandlers.length,
      "attack-surface fixture was not content-detected as n8n (no n8n handlers in inventory)",
    ).toBeGreaterThanOrEqual(2);
    // The JSON-workflow synthetic handler (framework n8n-workflow) and the custom-node TS handler.
    expect(n8nHandlers.some((h) => h.framework === "n8n-workflow")).toBe(true);

    const n8nFindings = env.scan.findings.filter((f) => f.rule_id.startsWith("n8n/"));
    expect(n8nFindings.length).toBeGreaterThanOrEqual(2);

    // Detector #1 — critical, on the workflow JSON.
    const detector1 = n8nFindings.find(
      (f) => f.rule_id === "n8n/webhook-trigger-no-authentication",
    );
    expect(detector1, "detector #1 (critical trigger) did not fire").toBeDefined();
    expect(detector1?.severity).toBe("critical");
    expect(detector1?.file_path).toMatch(/inbound\.workflow\.json$/);

    // Detector #2 — high, on the custom-node TS handler.
    const detector2 = n8nFindings.find(
      (f) => f.rule_id === "n8n/agent-tool-acts-on-unverified-payload",
    );
    expect(detector2, "detector #2 (high TS handler) did not fire").toBeDefined();
    expect(detector2?.severity).toBe("high");
    expect(detector2?.file_path).toMatch(/InboundAgent\.node\.ts$/);
  });

  it("SC#2: talos-mitigated is detected as n8n but emits ZERO n8n/* findings", async () => {
    const env = await scanFixtureJson("talos-mitigated");

    // Detection gate FIRST — the mitigated fixture MUST still be scanned (otherwise "zero findings"
    // is meaningless). Both handlers are content-detected as n8n.
    const n8nHandlers = env.scan.inventory.filter((h) => h.provider === "n8n");
    expect(
      n8nHandlers.length,
      "mitigated fixture was not content-detected as n8n — 'zero findings' would be vacuous",
    ).toBeGreaterThanOrEqual(2);
    expect(n8nHandlers.some((h) => h.framework === "n8n-workflow")).toBe(true);

    const n8nFindings = env.scan.findings.filter((f) => f.rule_id.startsWith("n8n/"));
    expect(
      n8nFindings,
      `mitigated fixture must emit ZERO n8n/* findings, got: ${n8nFindings.map((f) => f.rule_id).join(", ")}`,
    ).toEqual([]);
  });

  it("Negative (T-24-13): a malformed *.workflow.json surfaces a parse-error finding, not a crash or silent drop", async () => {
    const env = await scanFixtureJson("malformed");

    expect(env.scan.parse_errors_count).toBeGreaterThanOrEqual(1);
    const parseError = env.scan.findings.find((f) => f.rule_id === "engine/parse-error");
    expect(
      parseError,
      "malformed workflow JSON did not surface an engine/parse-error finding",
    ).toBeDefined();
    expect(parseError?.file_path).toMatch(/broken\.workflow\.json$/);
  });
});
