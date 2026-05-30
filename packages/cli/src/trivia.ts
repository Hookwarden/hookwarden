// v0.7.3+ scan-wait trivia ticker — PostHog-style rotating tips during
// long scans. Zero-network (every fact is a string literal in this file);
// TTY-gated (no output in CI, NO_COLOR, or piped runs) so the JSON/SARIF
// envelopes are never polluted.
//
// Design notes:
//   - Only fires on scans that exceed ~1s. Most hookwarden scans complete
//     in <100ms, so the ticker rarely appears. Large monorepos see it.
//   - Output goes to stderr (preserves stdout for findings + JSON/SARIF)
//   - Each tip overwrites the previous via `\r\x1b[K` (clear-line); on
//     stop() the ticker line is erased so the result output starts clean.
//   - Order is shuffled per process so back-to-back runs aren't identical.
//
// Tone:
//   - Audit-grade, factual. Not cutesy. Mix of rule-pack trivia,
//     architectural facts, CVE callouts, and the occasional bit of swagger.
//   - 80-char max so terminal wrapping doesn't fire mid-tip.
//   - Anchor every claim in something the rule pack actually does or that
//     a security engineer would recognize as substantive.

import { dim } from "./render/colors.js";

/**
 * Rotating trivia bank. Add new entries freely; the ticker shuffles per run.
 * Keep each line under 80 chars (terminal-safe) and factual (no marketing
 * hype, no emoji unless it's a single Unicode separator).
 */
export const TRIVIA: ReadonlyArray<string> = [
  // Provider quirks — surface the per-provider rule-pack knowledge
  "Stripe's signature tolerance defaults to 300s. Wider = `replay-window-too-permissive`.",
  "Slack uses `v0:${ts}:${body}` for HMAC input. The colons matter — many handlers miss them.",
  "Twilio is the SHA-1 outlier. Every other major provider in the rule pack uses SHA-256.",
  "GitHub uses `X-Hub-Signature-256`, not `X-Signature`. Both shapes get caught.",
  "Mailchimp signs URLs by appending the secret as a path segment. The rule pack flags it.",
  "Shopify rotates secrets without rotating URLs — handlers must accept dual secrets in cutover.",
  "Notion uses a `verification-token`, not an HMAC. The rule pack treats it differently.",
  "PagerDuty supports multi-signature payloads. Mishandling one kills key rotation.",
  "Bitbucket prefixes signatures with `sha256=`. Forgetting to strip is a real bug.",
  "Zoom signs the URL itself, not the body. URL-only validation is in the rule pack.",
  // Architecture / zero-network swagger
  "Hookwarden has never made a network call during a scan. Run `lsof -p` if you don't trust us.",
  "The engine is pure-functional — same code in the CLI, GitHub Action, and MCP server.",
  "230 rules. 21 providers. 100% cited to CWE / RFC / Svix or the canonical spec.",
  "The rule pack ships inline with `@hookwarden/mcp` — content-hashed, drift-detected, pinned.",
  "Every internal CI gate has a name. `engine-no-network-libs` blocks supply-chain creep.",
  "Hookwarden ships under Apache-2.0. The CLI, engine, and rule packs stay open source.",
  // Methodology — three-state, test paths, baseline
  "Three-state verdicts (verified / not-verified / manual-review) keep FP rate <5%.",
  "Test files under `**/{test,tests,__tests__,spec,specs}/**` auto-downgrade to `info`.",
  "Run `hookwarden scan --baseline write` on a legacy repo. New findings only from then on.",
  "Verified handlers stay quiet — surfaced once, then never again. Less noise, more signal.",
  "`manual-review` is what hookwarden says when it can't statically prove safe or unsafe.",
  // Bug-class anchors
  "`verify-after-side-effect`: a DB write before signature check. Forged payload, fired write.",
  "`raw-body-misuse`: parsed JSON instead of raw bytes. HMAC fails on every legitimate event.",
  "`timing-unsafe-comparison`: `===` against an HMAC buffer leaks timing on fast networks.",
  "`hardcoded-secret-prefix`: `whsec_…` literal in source. Grepped, including `.env.example`.",
  // CVEs the rule pack covers
  "CVE-2026-41432: a Stripe webhook with an empty secret accepts everything. Flagged on every scan.",
  // AI-agent surface
  "Cursor, Continue, and Claude Code can call `scan_handler` via MCP — paste-and-verdict in your editor.",
  "`@hookwarden/mcp` is the first MCP server doing webhook signature verification. Local, deterministic.",
  // Auditor-facing
  "Every rule cites CWE, RFC, Svix, or Stripe's own spec. Followable to a stable external source.",
  "Hookwarden's `--format sarif` round-trips through GitHub Code Scanning. Dedupes via partial fingerprints.",
  "`hookwarden fix` rewrites the safe-codegen subset mechanically. The other 188 emit prose, not edits.",
  // OWASP / framing
  "OWASP doesn't have a 'webhook signature verification' category. We started one.",
  "Webhooks are the largest unaudited attack surface in most SaaS apps. We're working on it.",
  "Every dollar of fraud that flows through a webhook starts with a verification bug.",
];

export interface TriviaTickerOptions {
  /** Disable the ticker (CI default, --no-trivia, NO_COLOR, non-TTY). */
  readonly disabled: boolean;
  /** Override TRIVIA bank — used by tests. */
  readonly trivia?: ReadonlyArray<string>;
  /** Override delays — used by tests. Default: 1000ms start, 3000ms rotate. */
  readonly startDelayMs?: number;
  readonly rotateMs?: number;
  /** Stream to write to — used by tests. Default: process.stderr. */
  readonly stream?: { write: (s: string) => boolean | void; isTTY?: boolean };
}

/**
 * Picks the right disabled-state from the environment + flags. Order:
 *   - explicit `--no-trivia` always wins
 *   - non-TTY stderr (piped, redirected, captured): disabled
 *   - CI env var (most CI providers set this): disabled
 *   - NO_COLOR (universal opt-out for any decorative output): disabled
 */
export function shouldDisableTrivia(args: {
  readonly noTrivia?: boolean;
  readonly stream?: { isTTY?: boolean };
  readonly env?: NodeJS.ProcessEnv;
}): boolean {
  if (args.noTrivia === true) return true;
  const stream = args.stream ?? process.stderr;
  if (stream.isTTY !== true) return true;
  const env = args.env ?? process.env;
  const ci = env["CI"];
  if (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") return true;
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return true;
  return false;
}

/**
 * Fisher-Yates shuffle (deterministic given a seed RNG; we use Math.random
 * so the bank rotates per process — same content, different starting tip).
 */
function shuffle<T>(arr: ReadonlyArray<T>): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/**
 * Start the ticker — call before the async work begins. Returns a stop()
 * function that the caller MUST invoke before printing anything else to
 * stderr (the stop clears the ticker line via `\r\x1b[K`).
 *
 * If `disabled` is true, returns a no-op stop() and the ticker never fires.
 */
export function startTriviaTicker(opts: TriviaTickerOptions): () => void {
  if (opts.disabled) {
    return () => {
      // no-op
    };
  }
  const stream = opts.stream ?? process.stderr;
  const trivia = opts.trivia ?? TRIVIA;
  const startDelayMs = opts.startDelayMs ?? 1000;
  const rotateMs = opts.rotateMs ?? 3000;

  if (trivia.length === 0) {
    return () => {
      // no-op — empty bank
    };
  }

  const shuffled = shuffle(trivia);
  let index = 0;
  let interval: NodeJS.Timeout | null = null;
  let active = false;

  const print = (): void => {
    const tip = shuffled[index % shuffled.length] ?? "";
    // `\r` returns to column 0; `\x1b[K` erases to end of line. Together
    // they overwrite the previous tip in-place so the terminal doesn't
    // scroll. Indent matches finding-body indent for visual continuity.
    stream.write(`\r\x1b[K  ${dim(tip, { useAnsi: true })}`);
    active = true;
    index += 1;
  };

  const startTimer = setTimeout(() => {
    print();
    interval = setInterval(print, rotateMs);
  }, startDelayMs);

  return () => {
    clearTimeout(startTimer);
    if (interval !== null) clearInterval(interval);
    if (active) {
      // Erase the ticker line so the next caller's output starts clean.
      stream.write("\r\x1b[K");
    }
  };
}
