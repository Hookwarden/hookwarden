// PayPal / Braintree / NMI provider packs — filesystem E2E through the real CLI (`main(argv)`).
//
// Each provider has an unverified/verified fixture pair under e2e/fixtures/payment-providers/.
// Detection is asserted FIRST ([[project_e2e_fixture_detection_gotcha]]): a fixture that isn't
// attributed to the provider produces zero findings and would "pass" while proving nothing.
//   - unverified → `<provider>/missing-signature-verification` (critical, not-verified)
//   - verified   → no not-verified / manual-review finding for the provider (SDK providers emit
//                  `library-verified`, which is state `verified`)

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../packages/cli/src/index.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/payment-providers",
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

describe.each(["nmi", "braintree", "paypal"])("%s provider pack — filesystem E2E", (provider) => {
  it("unverified fixture is attributed to the provider and fires missing-signature-verification", async () => {
    const env = await scanFixtureJson(`${provider}-unverified`);
    expect(
      env.scan.inventory.filter((h) => h.provider === provider).length,
      `${provider}-unverified was not attributed to ${provider}`,
    ).toBe(1);
    const missing = env.scan.findings.find(
      (f) => f.rule_id === `${provider}/missing-signature-verification`,
    );
    expect(missing?.severity).toBe("critical");
    expect(missing?.state).toBe("not-verified");
  });

  it("verified fixture is attributed to the provider and has no unverified or review findings", async () => {
    const env = await scanFixtureJson(`${provider}-verified`);
    expect(
      env.scan.inventory.filter((h) => h.provider === provider).length,
      `${provider}-verified was not attributed to ${provider} — 'no findings' would be vacuous`,
    ).toBe(1);
    const flagged = env.scan.findings.filter(
      (f) => f.rule_id.startsWith(`${provider}/`) && f.state !== "verified",
    );
    expect(flagged).toEqual([]);
  });
});

// Regression cases from code review of the provider packs.
describe("payment-provider packs — review regressions", () => {
  it("a header-only Standard Webhooks handler stays standardwebhooks (NMI shares the header) and is flagged", async () => {
    const env = await scanFixtureJson("standardwebhooks-header-only");
    expect(env.scan.inventory.map((h) => h.provider)).toEqual(["standardwebhooks"]);
    const missing = env.scan.findings.find(
      (f) => f.rule_id === "standardwebhooks/missing-signature-verification",
    );
    expect(missing?.state).toBe("not-verified");
  });

  it("a PayPal postback whose verification_status is never checked is not treated as verified", async () => {
    const env = await scanFixtureJson("paypal-postback-unchecked");
    expect(env.scan.inventory.map((h) => h.provider)).toEqual(["paypal"]);
    expect(env.scan.findings.some((f) => f.rule_id === "paypal/library-verified")).toBe(false);
    const missing = env.scan.findings.find(
      (f) => f.rule_id === "paypal/missing-signature-verification",
    );
    expect(missing?.state).toBe("manual-review");
  });

  it("an unverified PayPal route does not inherit another route's postback in the same file", async () => {
    const env = await scanFixtureJson("paypal-mixed-routes");
    const findings = env.scan.findings.filter((f) => f.rule_id.startsWith("paypal/"));
    expect(findings.filter((f) => f.rule_id === "paypal/library-verified")).toHaveLength(1);
    expect(
      findings.some(
        (f) => f.rule_id === "paypal/missing-signature-verification" && f.state !== "verified",
      ),
    ).toBe(true);
  });

  it("Braintree PHP instance form $gateway->webhookNotification()->parse() is recognized", async () => {
    const env = await scanFixtureJson("braintree-php-instance");
    expect(env.scan.inventory.map((h) => h.provider)).toEqual(["braintree"]);
    expect(env.scan.findings.map((f) => `${f.rule_id}:${f.state}`)).toEqual([
      "braintree/library-verified:verified",
    ]);
  });
});
