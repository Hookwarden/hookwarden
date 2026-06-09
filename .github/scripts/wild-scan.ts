// Weekly "bugs in the wild" sweep.
//
// Clones each public OSS target from .github/scripts/wild-targets.txt,
// runs hookwarden against it, aggregates findings (counts only — never
// per-target details), and updates the live table in README.md between
// the HOOKWARDEN_WILD_TABLE_{START,END} markers.
//
// Triggered by .github/workflows/wild-scan.yml on a weekly cron. The
// workflow opens a PR with the README diff if numbers changed.
//
// Per-target findings stay private — we only ever publish:
//   - The target list (the corpus is transparent)
//   - Aggregate severity counts across the corpus
//   - The scan date
//
// This avoids the "we found X bugs in cal.com" pre-disclosure landmine
// while still proving the product runs against real code every week.
//
// biome-ignore-all lint/suspicious/noConsole: this is a CLI script that
// prints progress to stdout/stderr by design — output goes into the
// GH Actions log so reviewers can see what the cron run did.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const TARGETS_FILE = join(HERE, "wild-targets.txt");
const README = join(REPO_ROOT, "README.md");
const WORKDIR = process.env.WILD_WORKDIR ?? "/tmp/hw-wild";
const HW_VERSION = process.env.HW_VERSION ?? "latest";

const START_MARKER = "<!-- HOOKWARDEN_WILD_TABLE_START -->";
const END_MARKER = "<!-- HOOKWARDEN_WILD_TABLE_END -->";

interface Finding {
  readonly rule_id: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly state: "verified" | "not-verified" | "manual-review";
}

interface ScanResult {
  readonly scan: {
    readonly findings: ReadonlyArray<Finding>;
  };
}

/** Per-provider severity/state breakdown for one table row. Counts come
 *  from the ACTUAL finding severities/states — never re-derived from the
 *  rule_id — so the rendered table reconciles with the corpus totals. */
export interface ProviderBucket {
  readonly critical: number;
  readonly high: number;
  /** Findings that are neither critical nor high severity: medium/low/info
   *  or anything left in the manual-review state. The "needs a human" tier. */
  readonly manualReview: number;
  /** rule_id → count, for the "Rules that fired" cell. */
  readonly rules: Readonly<Record<string, number>>;
}

export interface Aggregate {
  readonly targetsScanned: number;
  readonly targetsClean: number;
  readonly findings: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
    readonly manualReview: number;
  };
  /** Per-rule-id counts across the corpus, e.g. { "stripe/raw-body-misuse": 2 }.
   *  Provider prefix kept so readers see WHICH provider's rule fired.
   *  Per-project attribution is intentionally NOT tracked — see
   *  bugs-in-the-wild.md. */
  readonly byRuleId: Readonly<Record<string, number>>;
  /** Per-provider breakdown the table renders one row per. Keyed by the
   *  provider prefix of the rule_id (`stripe`, `n8n`, `standardwebhooks`,
   *  `engine`, …). New providers appear automatically — nothing is dropped
   *  by a hardcoded provider list. */
  readonly byProvider: Readonly<Record<string, ProviderBucket>>;
  readonly failed: ReadonlyArray<string>;
}

/** Friendly name + one-sentence explanation for each rule class hookwarden
 *  ships. Anything not in this table renders as the raw rule_id with a
 *  generic "uncategorized" tag — surfaces new rules without breaking the
 *  table. Severity uses the worst observed across providers. */
interface RuleClassMeta {
  readonly name: string;
  readonly severity: "critical" | "high" | "medium" | "manual-review";
  readonly meaning: string;
}

const RULE_CLASS_META: Readonly<Record<string, RuleClassMeta>> = {
  "missing-signature-verification": {
    name: "Missing signature verification",
    severity: "critical",
    meaning:
      "Handler accepts webhook payloads without checking the HMAC. Anyone who learns the endpoint can forge events.",
  },
  "raw-body-misuse": {
    name: "Raw body misuse",
    severity: "critical",
    meaning:
      "Body is parsed (JSON) before HMAC reads it. Signature is computed over different bytes than the sender signed — verification fails on every webhook.",
  },
  "express-middleware-ordering": {
    name: "Middleware ordering bug",
    severity: "critical",
    meaning:
      "`express.json()` registered before the webhook route consumes the raw bytes the HMAC needs.",
  },
  "hardcoded-secret-prefix": {
    name: "Hardcoded webhook secret",
    severity: "critical",
    meaning:
      "A literal `whsec_*` / `ghs_*` value appears in source. Once committed, it lives in git history and Docker images forever.",
  },
  "timing-unsafe-comparison": {
    name: "Timing-unsafe comparison",
    severity: "high",
    meaning:
      "`==` or `===` used to compare HMACs. Leaks the secret one byte at a time over a fast network.",
  },
  "wrong-hmac-algorithm": {
    name: "Wrong HMAC algorithm",
    severity: "high",
    meaning:
      "HMAC computed with a different algorithm than the provider documents (e.g., SHA-1 where SHA-256 is required).",
  },
  "missing-timestamp-check": {
    name: "Missing replay defense (timestamp)",
    severity: "high",
    meaning:
      "No timestamp tolerance check. Intercepted past webhooks can be replayed indefinitely.",
  },
  "missing-replay-defense": {
    name: "Missing replay defense",
    severity: "manual-review",
    meaning: "GitHub-specific. No `X-GitHub-Delivery` UUID dedupe visible to the engine.",
  },
  "unreachable-verification": {
    name: "Unreachable verification",
    severity: "manual-review",
    meaning:
      "Verification code exists in the file but the engine couldn't prove it runs before the handler returns. Often a conditional path or early `return`.",
  },
  "missing-timing-safe-equal": {
    name: "Missing timing-safe equality (JS)",
    severity: "high",
    meaning:
      "JS-specific. Manual HMAC computed but `crypto.timingSafeEqual` not used for the comparison.",
  },
  "parse-error": {
    name: "Files the engine couldn't parse",
    severity: "manual-review",
    meaning:
      "Engine signal, not a user bug. Source file is syntactically broken or uses a language feature the parser doesn't understand. Scan continues; those files just don't contribute findings.",
  },
};

function readTargets(): ReadonlyArray<string> {
  const raw = readFileSync(TARGETS_FILE, "utf8");
  return (
    raw
      .split("\n")
      // Strip inline `# annotation` comments before trimming — without
      // this, the annotation bleeds into the repo string passed to git
      // clone. The shell then treats # as a comment and git falls back
      // to its default dest (the repo name in the current dir), which
      // pollutes the workspace and trips downstream lint/preflight hooks.
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter((l) => l.length > 0)
  );
}

function ensureCli(): string {
  // CI installs the published hookwarden into a side directory so this
  // script doesn't depend on the workspace build. Local dev can override
  // via HOOKWARDEN_BIN.
  if (process.env.HOOKWARDEN_BIN !== undefined) return process.env.HOOKWARDEN_BIN;
  const cliRoot = join(WORKDIR, "cli");
  mkdirSync(cliRoot, { recursive: true });
  if (!existsSync(join(cliRoot, "node_modules/.bin/hookwarden"))) {
    writeFileSync(join(cliRoot, "package.json"), '{"name":"wild-scan","private":true}\n');
    execSync(`npm install hookwarden@${HW_VERSION} --silent --no-fund --no-audit`, {
      cwd: cliRoot,
      stdio: "inherit",
    });
  }
  return join(cliRoot, "node_modules/.bin/hookwarden");
}

function cloneTarget(repo: string): string {
  const name = repo.replace("/", "_");
  const dest = join(WORKDIR, "repos", name);
  if (existsSync(dest)) {
    // Refresh — pull latest main. Stale clones would slowly drift from reality.
    try {
      execSync("git fetch --depth 1 origin", { cwd: dest, stdio: "ignore" });
      execSync("git reset --hard FETCH_HEAD", { cwd: dest, stdio: "ignore" });
      return dest;
    } catch {
      rmSync(dest, { recursive: true, force: true });
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  execSync(`git clone --depth 1 --filter=blob:limit=2m https://github.com/${repo} "${dest}"`, {
    stdio: "ignore",
  });
  return dest;
}

function scanOne(hw: string, dir: string): ScanResult | null {
  const res = spawnSync(hw, ["scan", dir, "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  // Exit codes: 0 = clean, 1 = findings at threshold. Either has parseable JSON.
  // Exit codes 2+ = engine error → null aggregate.
  if (res.status !== null && res.status > 1) return null;
  try {
    return JSON.parse(res.stdout) as ScanResult;
  } catch {
    return null;
  }
}

/** Strip the provider prefix from a rule_id: `stripe/missing-signature-verification`
 *  → `missing-signature-verification`. Leaves anything without a `/` untouched. */
function ruleClass(ruleId: string): string {
  const idx = ruleId.indexOf("/");
  return idx === -1 ? ruleId : ruleId.slice(idx + 1);
}

function aggregate(targets: ReadonlyArray<string>, hw: string): Aggregate {
  let critical = 0,
    high = 0,
    medium = 0,
    low = 0,
    info = 0;
  let manualReview = 0;
  let clean = 0;
  const byRuleId: Record<string, number> = {};
  type MutableBucket = {
    critical: number;
    high: number;
    manualReview: number;
    rules: Record<string, number>;
  };
  const byProvider: Record<string, MutableBucket> = {};
  const failed: string[] = [];

  for (const repo of targets) {
    console.log(`▸ ${repo}`);
    let dir: string;
    try {
      dir = cloneTarget(repo);
    } catch (e) {
      console.error(`  ✗ clone failed: ${(e as Error).message}`);
      failed.push(repo);
      continue;
    }
    const result = scanOne(hw, dir);
    if (result === null) {
      console.error(`  ✗ scan failed`);
      failed.push(repo);
      continue;
    }
    const fs = result.scan.findings;
    const blocking = fs.filter((f) => f.severity === "critical" || f.severity === "high").length;
    if (blocking === 0) clean += 1;
    for (const f of fs) {
      if (f.severity === "critical") critical += 1;
      else if (f.severity === "high") high += 1;
      else if (f.severity === "medium") medium += 1;
      else if (f.severity === "low") low += 1;
      else if (f.severity === "info") info += 1;
      if (f.state === "manual-review") manualReview += 1;
      // library-verified is the positive signal that a handler is
      // correctly using the SDK — never a bug, always filtered out.
      if (ruleClass(f.rule_id) !== "library-verified") {
        byRuleId[f.rule_id] = (byRuleId[f.rule_id] ?? 0) + 1;
        // Per-provider tally for the table. Bucket by the finding's REAL
        // severity (critical / high), and fold medium/low/info + anything
        // left in the manual-review state into the manual-review tier.
        const provider = f.rule_id.split("/")[0] ?? "unknown";
        const pr = byProvider[provider] ?? { critical: 0, high: 0, manualReview: 0, rules: {} };
        byProvider[provider] = pr;
        if (f.severity === "critical") pr.critical += 1;
        else if (f.severity === "high") pr.high += 1;
        else pr.manualReview += 1;
        pr.rules[f.rule_id] = (pr.rules[f.rule_id] ?? 0) + 1;
      }
    }
    console.log(
      `  ✓ ${fs.length} findings (${critical} critical, ${high} high, ${manualReview} manual-review)`,
    );
  }
  return {
    targetsScanned: targets.length - failed.length,
    targetsClean: clean,
    findings: { critical, high, medium, low, info, manualReview },
    byRuleId,
    byProvider,
    failed,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Core providers always shown in the table (even at zero findings) to
 *  prove breadth of coverage. Any OTHER provider that fires — n8n,
 *  standardwebhooks, future additions — is appended dynamically from the
 *  aggregate, so nothing is ever silently dropped. `engine` (parse-error
 *  diagnostics) is deliberately NOT a table row; see the footnote. */
const coreProviders: ReadonlyArray<string> = [
  "stripe",
  "github",
  "shopify",
  "slack",
  "twilio",
  "square",
];

/** Friendly labels for providers whose nice-casing the fallback can't
 *  guess (brand casing like "n8n", multi-word like "Standard Webhooks").
 *  Anything not here falls back to "<Capitalized> integrations". */
const providerLabel: Readonly<Record<string, string>> = {
  stripe: "Stripe integrations",
  github: "GitHub integrations",
  shopify: "Shopify integrations",
  slack: "Slack integrations",
  twilio: "Twilio integrations",
  square: "Square integrations",
  n8n: "n8n integrations",
  standardwebhooks: "Standard Webhooks integrations",
  svix: "Svix integrations",
};

/** Labels are framed as "<Provider> integrations" so a row can't be
 *  misread as "Stripe has 2 bugs in their product" — the findings live in
 *  the webhook HANDLERS the corpus projects wrote, never in the provider's
 *  own SDK or service. The footer note reinforces this. */
function labelFor(provider: string): string {
  const known = providerLabel[provider];
  if (known !== undefined) return known;
  const titled = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${titled} integrations`;
}

export function renderTable(a: Aggregate): string {
  const lines: string[] = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push(`### Found in the wild`);
  lines.push("");
  lines.push(
    `Every Sunday at 22:00 UTC, this repo's CI runs \`hookwarden\` against **${a.targetsScanned} popular open-source projects** — currently cal.com, documenso, formbricks, twenty, plane, unkey, typebot, papermark ([full target list](./.github/scripts/wild-targets.txt), combined ★190k+) — to prove the scanner works on real production code.`,
  );
  lines.push("");
  lines.push(
    `**Latest sweep — ${todayIso()}** · ${a.targetsClean}/${a.targetsScanned} projects clean (zero critical/high)`,
  );
  lines.push("");

  // Render one row PER PROVIDER, driven by the aggregate so the table
  // always reconciles with the corpus totals. The core providers show
  // even at zero (breadth proof); any other provider that fired is
  // appended. `engine` parse-error diagnostics are excluded from the
  // table — they're surfaced as a footnote below, not as handler bugs.
  const fired = Object.keys(a.byProvider).filter((p) => p !== "engine");
  const rowProviders = [...new Set([...coreProviders, ...fired])];
  // Sort most-severe first (critical, then high, then manual-review),
  // ties alphabetical so the order is stable run-to-run.
  rowProviders.sort((x, y) => {
    const bx = a.byProvider[x];
    const by = a.byProvider[y];
    const d =
      (by?.critical ?? 0) - (bx?.critical ?? 0) ||
      (by?.high ?? 0) - (bx?.high ?? 0) ||
      (by?.manualReview ?? 0) - (bx?.manualReview ?? 0);
    return d !== 0 ? d : x.localeCompare(y);
  });

  lines.push(`| Provider | 🚨 critical | ⚠️ high | 🟡 manual-review | Rules that fired |`);
  lines.push(`|---|---:|---:|---:|---|`);
  for (const p of rowProviders) {
    const row = a.byProvider[p];
    const ruleEntries = row === undefined ? [] : Object.entries(row.rules);
    const rulesCell =
      ruleEntries.length === 0
        ? "—"
        : ruleEntries
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([id, n]) => `\`${id}\` (×${n})`)
            .join("<br>");
    lines.push(
      `| ${labelFor(p)} | ${row?.critical ?? 0} | ${row?.high ?? 0} | ${row?.manualReview ?? 0} | ${rulesCell} |`,
    );
  }
  lines.push("");
  // Framing note (A): readers may misread the per-provider rows as
  // "Stripe has 2 critical bugs in their product." This sentence makes
  // the relationship explicit so we don't imply provider liability for
  // bugs that live in the integrating project's webhook handler code.
  lines.push(
    `_These are bugs in the webhook **handlers** that receive provider events — flaws in the integrating projects' integration code, not in the providers' own SDKs or services._`,
  );
  lines.push("");
  // Parse-coverage footnote: parse-errors are an engine observability
  // signal (files it couldn't parse), NOT handler bugs — so they're kept
  // out of the per-provider table to avoid inflating the manual-review
  // count, but surfaced here for honesty about scan coverage.
  const parseErrors = a.byRuleId["engine/parse-error"] ?? 0;
  if (parseErrors > 0) {
    lines.push(
      `_Coverage note: the engine couldn't parse **${parseErrors}** files across the corpus (broken syntax or language features the parser doesn't model). Those are scan-coverage diagnostics — not handler bugs — and are excluded from the table above._`,
    );
    lines.push("");
  }
  // Coverage-scope note: without this, a 1-row table looks like "the
  // scanner didn't do much." With it, the reader knows the BREADTH
  // hookwarden checked even when most categories don't fire on
  // well-maintained code.
  const checkedClasses = Object.keys(RULE_CLASS_META).length;
  // Canonical published provider-coverage claim — must match the other
  // "N providers" claims elsewhere in README.md (hero, comparison table,
  // roadmap). This is the curated marketing number, NOT the count of
  // providers that happened to fire in this corpus (the table above shows
  // only 6 of them) and NOT PROVIDER_CATALOG.length. A prior literal `6`
  // here clobbered the "21 providers" claim on every sweep, leaving the
  // README self-contradictory.
  const publishedProviderCount = 21;
  lines.push(
    `_Hookwarden checks **${checkedClasses} rule classes** across **${publishedProviderCount} providers** — most of the corpus handles webhooks correctly, hence the short list. The full rule catalog lives in the [docs](https://github.com/Hookwarden/hookwarden/tree/main/apps/docs/src/content/docs/rules)._`,
  );
  lines.push("");
  lines.push(
    `Per-target findings are never published before responsible disclosure — see [methodology](./bugs-in-the-wild.md). To run the same scan against your own code:`,
  );
  lines.push("");
  lines.push("```bash");
  lines.push("npx hookwarden scan ./your-app");
  lines.push("```");
  lines.push("");
  lines.push(END_MARKER);
  return lines.join("\n");
}

function updateReadme(table: string): boolean {
  const original = readFileSync(README, "utf8");
  const pattern = new RegExp(
    `${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`,
    "g",
  );
  if (!pattern.test(original)) {
    throw new Error(
      `README is missing the table markers. Add a block between\n  ${START_MARKER}\n  ${END_MARKER}\nfirst.`,
    );
  }
  const updated = original.replace(pattern, table);
  if (updated === original) return false;
  writeFileSync(README, updated);
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  console.log(`▸ wild-scan starting (hookwarden@${HW_VERSION})`);
  const targets = readTargets();
  console.log(`▸ ${targets.length} targets`);
  const hw = ensureCli();
  console.log(`▸ using cli: ${hw}`);
  const agg = aggregate(targets, hw);
  console.log(`▸ aggregate: ${JSON.stringify(agg)}`);
  const table = renderTable(agg);
  const changed = updateReadme(table);
  if (changed) {
    console.log("✓ README table updated");
  } else {
    console.log("✓ README table unchanged");
  }
}

// Auto-run only when executed directly (CI: `tsx wild-scan.ts`), not when
// imported by a test that exercises renderTable() in isolation.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
