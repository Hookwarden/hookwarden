// Phase 3 success-criterion proofs. Each test runs `main(argv)` in-process against a
// fixture under e2e/fixtures/phase-3/, captures stdout, and asserts the success-criterion
// substring is present in the rendered output.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../packages/cli/src/index.js";

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/phase-3");

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

let savedNoColor: string | undefined;
beforeEach(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe("Phase 3 success criteria", () => {
  it("Criterion #2: canonical Stripe bug → not-verified critical with Stripe-doc-quote", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "canonical-stripe-bug")]),
    );
    expect(out.exitCode).toBe(1);
    // Compact rendering: `× critical` glyph + lowercase severity, bare
    // state (no brackets — column spacing disambiguates), `docs ›` prefix.
    expect(out.stdout).toContain("× critical");
    expect(out.stdout).toContain("stripe/missing-signature-verification");
    expect(out.stdout).toContain("not-verified");
    // Tolerate wrap variance: substring chosen to be < 50 chars so it stays
    // on a single line for any wrap width >= 80 cols.
    expect(out.stdout).toContain("always verify events");
    expect(out.stdout).toContain("docs › https://stripe.com/docs/webhooks");
  });

  it("Criterion #3 JS/TS: stripe.webhooks.constructEvent reachable → verified", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "stripe-construct-event-happy-path")]),
    );
    expect(out.stdout).toContain("verified");
    expect(out.stdout).toContain("stripe/library-verified");
  });

  it("Criterion #3 Python: stripe.Webhook.construct_event reachable → verified", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "python-flask-happy-path")]),
    );
    expect(out.stdout).toContain("verified");
    expect(out.stdout).toContain("stripe/library-verified");
  });

  it("Criterion #4 RULES-05: hardcoded whsec_ inside __tests__/ → info severity, not-verified state, NOT critical (B-1)", async () => {
    // The fixture deliberately exercises a __tests__/ path to verify the
    // path_severity_overrides downgrade rule (D-57). Since test-path
    // exclusion now ships as a default, opt back in with --include-tests
    // so this fixture actually gets scanned.
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "seeded-secret"), "--include-tests"]),
    );
    expect(out.stdout).toContain("stripe/hardcoded-secret-prefix");
    // Compact rendering: severity is on the same line as the finding header
    // (`· info  file:line  rule_id  state`), not in a banner section above
    // a group. Search anchor: the line that contains the rule_id has the
    // severity glyph + label at column 0.
    const ruleIdx = out.stdout.indexOf("stripe/hardcoded-secret-prefix");
    expect(ruleIdx).toBeGreaterThanOrEqual(0);
    // The line containing the rule_id starts with the severity column;
    // walk back from ruleIdx to the start of that line and assert info.
    const lineStart = out.stdout.lastIndexOf("\n", ruleIdx) + 1;
    const headerLine = out.stdout.slice(lineStart, out.stdout.indexOf("\n", ruleIdx));
    expect(headerLine).toContain("· info");
    expect(headerLine).not.toContain("× critical");
    // D-57 contract: only severity is rewritten by path_severity_overrides; state stays.
    expect(headerLine).toContain("not-verified");
  });

  it("Criterion #5 RULES-08: every non-engine rule finding is followed by a docs › provider_docs_url line (W-1)", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "canonical-stripe-bug")]),
    );
    const lines = out.stdout.split(/\r?\n/);
    let pendingDocLink = false;
    let pendingLineCount = 0;
    let pendingIsEngine = false;
    let satisfied = 0;
    let total = 0;
    // Compact rendering: each finding header is a single line containing
    // `rule_id` (with provider/ prefix) and the state word. Body lines that
    // follow are indented by two spaces, with the docs link rendered as
    // `  docs › URL`.
    for (const line of lines) {
      if (
        /\s(stripe|github|engine)\//.test(line) &&
        /\s(verified|not-verified|manual-review)\b/.test(line) &&
        /^[\s·×!▲]/.test(line)
      ) {
        pendingDocLink = true;
        pendingLineCount = 0;
        pendingIsEngine = /\sengine\//.test(line);
        if (!pendingIsEngine) total++;
      } else if (pendingDocLink) {
        pendingLineCount++;
        if (line.includes("docs ›") && /https?:\/\//.test(line)) {
          if (!pendingIsEngine) satisfied++;
          pendingDocLink = false;
          pendingLineCount = 0;
          pendingIsEngine = false;
        } else if (pendingLineCount > 12) {
          pendingDocLink = false;
          pendingLineCount = 0;
          pendingIsEngine = false;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(satisfied).toBe(total);
  });
});

describe("DISCOVERY-01 inventory subcommand", () => {
  it("inventory prints framework | route_pattern | provider | state | file:line columns", async () => {
    const out = await captureStdout(() => main(["inventory", FIXTURE_ROOT]));
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("framework");
    expect(out.stdout).toContain("route_pattern");
    expect(out.stdout).toContain("provider");
    expect(out.stdout).toContain("state");
    expect(out.stdout).toContain("file:line");
    expect(out.stdout).toMatch(/\/webhooks\/stripe/);
  });
});
