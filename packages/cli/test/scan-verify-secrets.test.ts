// Phase 28 LEAK-06 — `scan --verify-secrets` end-to-end wiring (SC#2 default +
// entitlement-gated probe + exit-code escalation).
//
// Drives runScanCommand over a throwaway repo containing a hardcoded GitHub
// token. The entitlement preflight + the provider probe are mocked so the test
// is deterministic + offline; the REAL extraction + remap + exit path run.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entitlementMock = vi.hoisted(() => ({ allowed: true as boolean }));
const probeVerdict = vi.hoisted(() => ({ value: "live" as "live" | "dead" | "unverified" }));

vi.mock("../src/liveness/entitlement.js", async () => {
  const actual = await vi.importActual<typeof import("../src/liveness/entitlement.js")>(
    "../src/liveness/entitlement.js",
  );
  return {
    ...actual,
    checkVerifyEntitlement: vi.fn(async () =>
      entitlementMock.allowed ? { allowed: true } : { allowed: false, reason: "denied" as const },
    ),
  };
});

vi.mock("../src/liveness/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/liveness/index.js")>(
    "../src/liveness/index.js",
  );
  return {
    ...actual,
    // Keep extractCredential REAL; only the network probe is stubbed.
    probeLiveness: vi.fn(async () => probeVerdict.value),
  };
});

import { runScanCommand } from "../src/commands/scan.js";

const dirs: string[] = [];

// A leaking GitHub handler. The github/hardcoded-secret-prefix rule matches the
// `ghs_` prefix (an installation token — api-key class, probeable).
const LEAK_HANDLER = [
  "import express from 'express';",
  "const app = express();",
  "app.post('/webhooks/github', (req, res) => {",
  "  const token = 'ghs_ABCDEF0123456789TESTONLY';",
  "  res.send('ok');",
  "});",
].join("\n");

function mkRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hookwarden-vs-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "webhook.ts"), LEAK_HANDLER);
  return dir;
}

let stdout: ReturnType<typeof vi.spyOn>;
const out: string[] = [];

beforeEach(() => {
  entitlementMock.allowed = true;
  probeVerdict.value = "live";
  out.length = 0;
  stdout = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    out.push(typeof c === "string" ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  stdout.mockRestore();
  vi.clearAllMocks();
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

interface SarifDoc {
  runs: Array<{ results: Array<{ ruleId: string; properties: Record<string, string> }> }>;
}

function leakLiveness(): string | undefined {
  const sarif = JSON.parse(out.join("")) as SarifDoc;
  const result = sarif.runs[0]?.results.find((r) => r.ruleId.endsWith("/hardcoded-secret-prefix"));
  return result?.properties["hookwarden-liveness"];
}

describe("scan --verify-secrets", () => {
  it("SC#2: without the flag, the leak finding is unverified", async () => {
    const dir = mkRepo();
    await runScanCommand({ path: dir, format: "sarif" });
    expect(leakLiveness()).toBe("unverified");
  });

  it("with --verify-secrets + entitlement, a live verdict is reflected on the leak", async () => {
    const dir = mkRepo();
    probeVerdict.value = "live";
    await runScanCommand({ path: dir, "verify-secrets": true, format: "sarif" });
    expect(leakLiveness()).toBe("live");
  });

  it("a dead verdict downgrades the leak (reflected in SARIF)", async () => {
    const dir = mkRepo();
    probeVerdict.value = "dead";
    await runScanCommand({ path: dir, "verify-secrets": true, format: "sarif" });
    expect(leakLiveness()).toBe("dead");
  });

  it("denied entitlement: no crash, the leak stays unverified", async () => {
    const dir = mkRepo();
    entitlementMock.allowed = false;
    await runScanCommand({ path: dir, "verify-secrets": true, format: "sarif" });
    expect(leakLiveness()).toBe("unverified");
  });

  // The verdict→severity→exit remap (live→critical gates, dead→info does not) is
  // proven at the unit level in test/liveness/verdict.test.ts via
  // countActiveAtOrAbove — kept there to avoid the confound that any unverified
  // webhook handler also emits a separate missing-verification finding.
});
