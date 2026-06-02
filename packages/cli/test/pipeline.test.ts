// Pipeline orchestrator tests (Phase 4 Plan 09 Task 1).
// Composition tests covering: parse_candidates_count override (Blocker 1),
// suppression precedence, baseline auto-read, rule-pack drift delegation (Warning 11).

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ScanMetadata } from "@hookwarden/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DEFAULTS, type ResolvedConfig } from "../src/config/precedence.js";
import { evaluateParseCoverage } from "../src/parse-coverage.js";
import { type RunScanInput, runScan } from "../src/pipeline.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

function scanInput(overrides: Partial<ResolvedConfig> = {}): RunScanInput {
  return {
    rootPath: tmp,
    resolvedConfig: { ...CONFIG_DEFAULTS, ...overrides },
    diffOnly: false,
    diffBase: null,
    baselineWrite: false,
    verbose: false,
  };
}

const STRIPE_BUG_SOURCE = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');

app.post('/webhook', express.json(), (req, res) => {
  // Missing signature verification — this should produce a critical finding.
  const event = req.body;
  res.json({ received: true });
});
`;

const CLEAN_SOURCE = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET!);

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WHSEC!);
  res.json({ received: true });
});
`;

describe("runScan — Blocker 1: parse_candidates_count override (CLI-04 sc4)", () => {
  it("populates parse_candidates_count from walker.files.length after engine.evaluate", async () => {
    await writeFile("a.ts", CLEAN_SOURCE);
    await writeFile("b.ts", CLEAN_SOURCE);
    await writeFile("c.ts", CLEAN_SOURCE);
    const out = await runScan(scanInput());
    expect(out.result.metadata.parse_candidates_count).toBe(3);
    expect(out.result.metadata.parse_candidates_count).toBe(out.walkResult.files.length);
  });

  it("overridden parse_candidates_count flows into evaluateParseCoverage denominator", async () => {
    await writeFile("a.ts", CLEAN_SOURCE);
    await writeFile("b.ts", CLEAN_SOURCE);
    const out = await runScan(scanInput());
    const cov = evaluateParseCoverage(out.result.metadata, 0.95);
    expect(cov.candidates).toBe(2);
    expect(cov.belowMin).toBe(false);
  });

  it("regression guard: if parse_candidates_count were 0 (pre-Blocker-1), the gate would silently pass", () => {
    // Documents the failure mode the override prevents.
    const fakeMeta: ScanMetadata = {
      engine_version: "0.0.0",
      engine_commit_sha: null,
      rule_pack_version: "0.0.0",
      rule_pack_content_hash: "sha256:0",
      scanned_at: "2026-05-04T00:00:00.000Z",
      parse_errors_count: 5,
      parsed_files_count: 95,
      total_files_count: 100,
      parse_candidates_count: 0, // pre-fix placeholder
    };
    const cov = evaluateParseCoverage(fakeMeta, 0.95);
    // candidates === 0 short-circuits; ratio is 1, gate trivially passes — broken behavior.
    expect(cov.belowMin).toBe(false);
    expect(cov.ratio).toBe(1);
  });
});

describe("runScan — composition", () => {
  it("returns RunScanOutput shape with all Phase 4 fields", async () => {
    await writeFile("clean.ts", CLEAN_SOURCE);
    const out = await runScan(scanInput());
    expect(out).toMatchObject({
      result: expect.any(Object),
      ruleSet: expect.any(Object),
      durationMs: expect.any(Number),
      stale: expect.any(Array),
      preExistingCount: expect.any(Number),
      suppressedCount: expect.any(Number),
      diffBase: null, // diffOnly=false
      rulePackDrift: null, // no baseline
      engineError: null,
    });
  });

  it("emits a critical finding for the canonical Stripe missing-verification bug", async () => {
    await writeFile("webhook.ts", STRIPE_BUG_SOURCE);
    const out = await runScan(scanInput());
    expect(out.result.findings.length).toBeGreaterThan(0);
    const critical = out.result.findings.find((f) => f.severity === "critical");
    expect(critical).toBeDefined();
  });

  it("inline disable comment suppresses the finding (D-63 inline > ignore > baseline)", async () => {
    const sourceWithInlineDisable = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');

app.post('/webhook', express.json(), (req, res) => {
  // hookwarden-disable-next-line stripe/missing-verification
  const event = req.body;
  res.json({ received: true });
});
`;
    await writeFile("webhook.ts", sourceWithInlineDisable);
    const out = await runScan(scanInput());
    const stripeFinding = out.result.findings.find(
      (f) => f.rule_id === "stripe/missing-verification",
    );
    if (stripeFinding) {
      expect(stripeFinding.suppressed?.source).toBe("inline");
    }
  });

  it("captures engine errors as engineError (does not throw)", async () => {
    const emptyRules = await fs.mkdtemp(path.join(os.tmpdir(), "empty-rules-"));
    try {
      const out = await runScan(scanInput({ rules_dir: emptyRules }));
      expect(out.engineError).not.toBeNull();
    } finally {
      await fs.rm(emptyRules, { recursive: true, force: true });
    }
  });
});

describe("runScan — baseline auto-read (D-69) and rule-pack drift (Warning 11)", () => {
  it("auto-reads baseline when ResolvedConfig.baseline_enabled and file exists", async () => {
    await writeFile("clean.ts", CLEAN_SOURCE);
    const baselinePath = path.join(tmp, ".hookwarden.baseline.json");
    const baseline = {
      schema_version: "1.0",
      baselined_at: "2026-05-01T00:00:00.000Z",
      engine_version: "0.0.1",
      rule_pack_version: "0.0.0-old", // intentionally different from current RULES_PACK_VERSION
      rule_pack_content_hash: "sha256:abc",
      findings: [],
    };
    await fs.writeFile(baselinePath, JSON.stringify(baseline));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const out = await runScan(scanInput({ baseline_path: baselinePath }));
      expect(out.rulePackDrift).not.toBeNull();
      expect(out.rulePackDrift?.from).toBe("0.0.0-old");
      const messages = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(messages).toContain("note: baseline rule pack");
      expect(messages).toContain("0.0.0-old");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does not read baseline when baseline_enabled is false", async () => {
    await writeFile("clean.ts", CLEAN_SOURCE);
    const out = await runScan(scanInput({ baseline_enabled: false }));
    expect(out.rulePackDrift).toBeNull();
    expect(out.preExistingCount).toBe(0);
  });

  it("returns null rulePackDrift when no baseline file exists", async () => {
    await writeFile("clean.ts", CLEAN_SOURCE);
    const out = await runScan(scanInput());
    expect(out.rulePackDrift).toBeNull();
  });
});

describe("runScan — diff-only (CLI-08, D-72)", () => {
  it("with diffOnly=true and a 1-changed-file git repo, walks only the changed file", async () => {
    // Seed a tiny git repo with two files; modify only one; diff-only against HEAD.
    await writeFile("a.ts", CLEAN_SOURCE);
    await writeFile("b.ts", CLEAN_SOURCE);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp });
    execFileSync("git", ["config", "user.email", "test@test.test"], { cwd: tmp });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmp });
    execFileSync("git", ["add", "."], { cwd: tmp });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
    await writeFile("a.ts", `${CLEAN_SOURCE}\n// modified`);

    const out = await runScan({
      ...scanInput(),
      diffOnly: true,
      diffBase: "HEAD",
    });
    const rels = out.walkResult.files.map((f) => path.relative(tmp, f));
    expect(rels).toEqual(["a.ts"]);
    expect(out.result.metadata.parse_candidates_count).toBe(1);
    expect(out.diffBase).toBe("HEAD");
  });
});

// Phase 19 v0.7.1 (RD-RELEASE-01) — --severity-class rule filter.
// A verified Stripe handler that ALSO logs the webhook secret: unfiltered it
// produces a leak (secret-in-log-or-error) finding; under --severity-class
// production-bypass the leak class is filtered out (negative). The
// missing-verification bug stays (positive).
const STRIPE_VERIFIED_BUT_LEAKS_SECRET = `
import express from 'express';
import Stripe from 'stripe';
const app = express();
const stripe = new Stripe('sk_test');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  console.log(STRIPE_WEBHOOK_SECRET);
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  res.json({ received: true, id: event.id });
});
`;

describe("runScan — --severity-class production-bypass filter (Phase 19)", () => {
  it("keeps the missing-verification (production-bypass) finding under the filter", async () => {
    await writeFile("webhook.ts", STRIPE_BUG_SOURCE);
    const out = await runScan({ ...scanInput(), severityClassGroup: "production-bypass" });
    expect(out.result.findings.length).toBeGreaterThan(0);
    // Every emitted finding must belong to the production-bypass class set.
    expect(out.result.findings.every((f) => !f.rule_id.endsWith("secret-in-log-or-error"))).toBe(
      true,
    );
  });

  it("drops the secret-in-log (leak) finding that is present unfiltered", async () => {
    await writeFile("webhook.ts", STRIPE_VERIFIED_BUT_LEAKS_SECRET);

    const unfiltered = await runScan(scanInput());
    const leakUnfiltered = unfiltered.result.findings.filter((f) =>
      f.rule_id.endsWith("secret-in-log-or-error"),
    );
    expect(leakUnfiltered.length).toBeGreaterThan(0); // precondition: the leak fires

    const filtered = await runScan({ ...scanInput(), severityClassGroup: "production-bypass" });
    const leakFiltered = filtered.result.findings.filter((f) =>
      f.rule_id.endsWith("secret-in-log-or-error"),
    );
    expect(leakFiltered.length).toBe(0); // negative: filtered out
  });
});
