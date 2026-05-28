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

interface Aggregate {
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
  readonly failed: ReadonlyArray<string>;
}

function readTargets(): ReadonlyArray<string> {
  const raw = readFileSync(TARGETS_FILE, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
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

function aggregate(targets: ReadonlyArray<string>, hw: string): Aggregate {
  let critical = 0,
    high = 0,
    medium = 0,
    low = 0,
    info = 0;
  let manualReview = 0;
  let clean = 0;
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
    }
    console.log(
      `  ✓ ${fs.length} findings (${critical} critical, ${high} high, ${manualReview} manual-review)`,
    );
  }
  return {
    targetsScanned: targets.length - failed.length,
    targetsClean: clean,
    findings: { critical, high, medium, low, info, manualReview },
    failed,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderTable(a: Aggregate): string {
  const lines: string[] = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push(`### Found in the wild`);
  lines.push("");
  lines.push(
    `Every Sunday at 22:00 UTC, this repo's CI runs \`hookwarden\` against **${a.targetsScanned} popular open-source projects** — currently cal.com, documenso, formbricks, twenty, plane, unkey, typebot, papermark ([full target list](./.github/scripts/wild-targets.txt), combined ★190k+) — to prove the scanner works on real production code.`,
  );
  lines.push("");
  lines.push(`**Latest sweep — ${todayIso()}:**`);
  lines.push("");
  lines.push(`| Findings across the ${a.targetsScanned}-project corpus | Count |`);
  lines.push("|---|---:|");
  lines.push(`| 🚨 Critical bugs | ${a.findings.critical} |`);
  lines.push(`| ⚠️ High-severity bugs | ${a.findings.high} |`);
  lines.push(`| 🟡 Manual-review (human confirms) | ${a.findings.manualReview} |`);
  lines.push(`| ✅ Projects with zero critical/high | ${a.targetsClean} / ${a.targetsScanned} |`);
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

void main();
