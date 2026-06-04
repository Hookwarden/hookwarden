// Phase 29 — Next.js Pages Router support. End-to-end proofs that a `pages/api/**` webhook is
// detected (P0) and that a correct handler reading the raw body via a getRawBody stream helper is
// NOT mislabeled raw-body-misuse (P1). Mirrors the phase-3 in-process capture harness.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../packages/cli/src/index.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/phase-29",
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

let savedNoColor: string | undefined;
beforeEach(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe("Phase 29 — Next.js Pages Router", () => {
  it("P0+P1: correct pages/api Stripe webhook (getRawBody + constructEvent) → verified, NO raw-body-misuse", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "pages-stripe-verified")]),
    );
    expect(out.stdout).toContain("verified");
    expect(out.stdout).toContain("stripe/library-verified");
    // The FP this phase fixes: a textbook-correct boxyhq-shape handler must NOT be flagged.
    expect(out.stdout).not.toContain("raw-body-misuse");
    expect(out.stdout).not.toContain("× critical");
    expect(out.exitCode).toBe(0);
  });

  it("P0: unverified pages/api Stripe webhook → not-verified critical (the FN that existed is closed)", async () => {
    const out = await captureStdout(() =>
      main(["scan", path.join(FIXTURE_ROOT, "pages-stripe-unverified")]),
    );
    expect(out.stdout).toContain("× critical");
    expect(out.stdout).toContain("not-verified");
    expect(out.stdout).toContain("stripe/missing-signature-verification");
    expect(out.exitCode).toBe(1);
  });
});
