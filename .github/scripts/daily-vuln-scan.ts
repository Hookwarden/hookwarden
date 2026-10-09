// Daily vuln diff-scan. Clones each repo in $DAILY_TARGETS (or daily-targets.txt locally), runs hookwarden,
// keeps only CONFIDENT reportable findings (severity critical/high AND state
// `not-verified` — manual-review is excluded per bugs-in-the-wild.md), and diffs
// against a baseline so only NEWLY-appeared findings are reported. Writes a plain-text
// report + sets GitHub Actions outputs; the workflow emails it when there is something new.
//
// Privacy: per bugs-in-the-wild.md we never PUBLISH per-target findings. The report and the
// baseline carry per-target detail, so both stay OUT of git — the report goes only to the
// private email recipient, and the baseline lives in the Actions cache (not publicly
// downloadable), never committed. This script writes no repo files.
//
// Run locally:  HOOKWARDEN_BIN=$(pnpm -s exec which hookwarden || echo npx) \
//               pnpm exec tsx .github/scripts/daily-vuln-scan.ts
// (local runs with no BASELINE_FILE just print the report and treat every finding as new.)
//
// biome-ignore-all lint/suspicious/noConsole: this is a CLI script; console is its UI.

import { execSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETS_FILE = process.env.DAILY_TARGETS_FILE ?? join(HERE, "daily-targets.txt");
const WORKDIR = process.env.HW_WORKDIR ?? join(HERE, "..", "..", ".daily-scan-work");
const BASELINE_FILE = process.env.BASELINE_FILE ?? ""; // empty => no persistence (local)
const REPORT_FILE = process.env.REPORT_FILE ?? join(WORKDIR, "daily-scan-report.txt");
const HW_VERSION = process.env.HW_VERSION ?? "latest";

interface Finding {
  readonly rule_id: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly state: "not-verified" | "manual-review" | "verified";
  readonly file_path: string;
  readonly location: { readonly line: number };
}
interface ScanResult {
  readonly scan: { readonly findings: ReadonlyArray<Finding> };
}

// A hit we track. Fingerprint deliberately ignores the line number so a finding that merely
// drifts lines is NOT re-reported as new; it is unique per (repo, rule, file).
interface Hit {
  readonly repo: string;
  readonly rule_id: string;
  readonly file_path: string;
  readonly severity: string;
  readonly line: number;
  readonly fingerprint: string;
}

function readTargets(): ReadonlyArray<string> {
  // CI passes the list via the DAILY_TARGETS secret so which repos we watch daily stays private.
  return (process.env.DAILY_TARGETS || readFileSync(TARGETS_FILE, "utf8"))
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);
}

function ensureCli(): string {
  if (process.env.HOOKWARDEN_BIN !== undefined) return process.env.HOOKWARDEN_BIN;
  const cliRoot = join(WORKDIR, "cli");
  mkdirSync(cliRoot, { recursive: true });
  if (!existsSync(join(cliRoot, "node_modules/.bin/hookwarden"))) {
    writeFileSync(join(cliRoot, "package.json"), '{"name":"daily-scan","private":true}\n');
    execSync(`npm install hookwarden@${HW_VERSION} --silent --no-fund --no-audit`, {
      cwd: cliRoot,
      stdio: "inherit",
    });
  }
  return join(cliRoot, "node_modules/.bin/hookwarden");
}

function cloneTarget(repo: string): string | null {
  const dest = join(WORKDIR, "repos", repo.replace("/", "_"));
  try {
    if (existsSync(dest)) {
      execSync("git fetch --depth 1 origin", { cwd: dest, stdio: "ignore" });
      execSync("git reset --hard FETCH_HEAD", { cwd: dest, stdio: "ignore" });
      return dest;
    }
    mkdirSync(dirname(dest), { recursive: true });
    execSync(`git clone --depth 1 --filter=blob:limit=2m https://github.com/${repo} "${dest}"`, {
      stdio: "ignore",
    });
    return dest;
  } catch {
    rmSync(dest, { recursive: true, force: true });
    return null;
  }
}

function scanOne(hw: string, dir: string): ScanResult | null {
  // Scan the WHOLE repo (never a subdir) so imported verification helpers resolve — a
  // narrower root silently turns helper-verified handlers into false `not-verified`s.
  const res = spawnSync(hw, ["scan", dir, "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (res.status !== null && res.status > 1) return null; // 0 = clean, 1 = findings; >1 = error
  try {
    return JSON.parse(res.stdout) as ScanResult;
  } catch {
    return null;
  }
}

function loadBaseline(): Set<string> {
  if (BASELINE_FILE && existsSync(BASELINE_FILE)) {
    try {
      return new Set(JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as string[]);
    } catch {
      /* corrupt baseline → treat as empty (first run) */
    }
  }
  return new Set();
}

function saveBaseline(fingerprints: ReadonlySet<string>): void {
  if (!BASELINE_FILE) return;
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify([...fingerprints].sort(), null, 0));
}

function setOutput(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
}

function renderReport(title: string, hits: ReadonlyArray<Hit>): string {
  const lines = [title, ""];
  const byRepo = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byRepo.get(h.repo);
    if (list) list.push(h);
    else byRepo.set(h.repo, [h]);
  }
  for (const [repo, list] of [...byRepo].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${repo} (${list.length})`);
    for (const h of list.sort((a, b) => a.file_path.localeCompare(b.file_path))) {
      lines.push(`  [${h.severity}] ${h.rule_id}  ${h.file_path}:${h.line}`);
    }
    lines.push("");
  }
  lines.push(
    "— hookwarden daily scan. Confirm each finding by hand and dedupe against the project's",
    "open issues/advisories before reporting (public search ≠ their private VDP backlog).",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const targets = readTargets();
  const hw = ensureCli();
  console.error(`daily-scan: ${targets.length} targets, hookwarden ${HW_VERSION}`);

  const allHits: Hit[] = [];
  const failed: string[] = [];
  for (const repo of targets) {
    const dir = cloneTarget(repo);
    if (!dir) {
      failed.push(repo);
      console.error(`  ${repo}: clone failed`);
      continue;
    }
    const result = scanOne(hw, dir);
    if (!result) {
      failed.push(repo);
      console.error(`  ${repo}: scan error`);
      continue;
    }
    const hits = result.scan.findings
      .filter(
        (f) => f.state === "not-verified" && (f.severity === "critical" || f.severity === "high"),
      )
      .map<Hit>((f) => ({
        repo,
        rule_id: f.rule_id,
        file_path: f.file_path,
        severity: f.severity,
        line: f.location.line,
        fingerprint: `${repo}::${f.rule_id}::${f.file_path}`,
      }));
    allHits.push(...hits);
    // Per-repo counts stay out of the public Actions log; the emailed report has them.
    if (!process.env.GITHUB_ACTIONS)
      console.error(`  ${repo}: ${hits.length} confident critical/high finding(s)`);
  }

  // Dedupe hits by fingerprint (first occurrence wins — stable line for the report).
  const uniqueHits = [...new Map(allHits.map((h) => [h.fingerprint, h])).values()];
  const current = new Set(uniqueHits.map((h) => h.fingerprint));

  const baseline = loadBaseline();
  const isFirstRun = BASELINE_FILE !== "" && baseline.size === 0;
  const newHits = uniqueHits.filter((h) => !baseline.has(h.fingerprint));

  // Baseline becomes the union: never re-alert a finding, and keep tracking resolved ones out.
  saveBaseline(current);

  const date = new Date().toISOString().slice(0, 10);
  let subject: string;
  let body: string;
  let hasNew: boolean;

  if (isFirstRun) {
    // Don't dump the whole existing backlog as "new" — just confirm monitoring is live.
    hasNew = false;
    subject = `hookwarden daily scan started — tracking ${current.size} findings`;
    body = renderReport(
      `hookwarden daily scan — baseline established ${date}\n` +
        `Now tracking ${current.size} confident critical/high finding(s) across ${targets.length} target(s).\n` +
        `You'll only be emailed when NEW findings appear. Current baseline:`,
      uniqueHits,
    );
  } else if (newHits.length > 0) {
    hasNew = true;
    subject = `hookwarden: ${newHits.length} NEW webhook finding(s) — ${date}`;
    body = renderReport(
      `hookwarden daily scan — ${newHits.length} NEW finding(s) on ${date}`,
      newHits,
    );
  } else {
    hasNew = false;
    subject = `hookwarden daily scan — no new findings ${date}`;
    body = `No new critical/high webhook findings across ${targets.length} target(s) on ${date}.`;
  }

  if (failed.length)
    body += `\n\n(note: ${failed.length} target(s) failed to scan: ${failed.join(", ")})`;

  mkdirSync(dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, body);
  setOutput("has_new", String(hasNew));
  setOutput("is_first_run", String(isFirstRun));
  setOutput("subject", subject);
  console.error(`\n${subject}\n`);
  if (!process.env.GITHUB_OUTPUT) console.log(body); // local run: just print it
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
