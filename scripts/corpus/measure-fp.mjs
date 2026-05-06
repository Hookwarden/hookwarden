#!/usr/bin/env node
// Runs hookwarden against every repo in the corpus, exports findings to
// JSONL, and computes a TP/FP rate from prior triage decisions.
//
// Workflow:
//   1. ./scripts/corpus/collect.mjs        → seeds repos.json (one-time)
//   2. ./scripts/corpus/measure-fp.mjs     → clones each repo at pinned sha,
//                                            runs hookwarden, exports findings,
//                                            joins with triage.json (manual).
//   3. Manual triage of any new findings   → user edits triage.json with
//                                            { finding_id: 'TP' | 'FP' | 'NA' }
//   4. ./scripts/corpus/measure-fp.mjs --report
//                                          → prints headline FP rate at
//                                            high+critical severity (the only
//                                            number that matters for the
//                                            buyer-call marketing line).
//
// Output paths (in private repo):
//   .planning/research/corpus-200/findings.jsonl  — every finding from every repo
//   .planning/research/corpus-200/triage.json     — manual TP/FP decisions
//   .planning/research/corpus-200/REPORT.md       — generated headline + breakdown
//
// Reproducibility: each repo is cloned to a temp dir at the pinned SHA. Findings
// have a stable hash from hookwarden's fingerprint, so re-runs after a hookwarden
// version bump only require triage of NEW findings (existing ones inherit prior
// triage decisions automatically via the finding_id key).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PRIVATE_PLANNING_ROOT = resolve(REPO_ROOT, "..", "webhook-security", ".planning");
const CORPUS_DIR = join(PRIVATE_PLANNING_ROOT, "research", "corpus-200");
const REPOS_FILE = join(CORPUS_DIR, "repos.json");
const FINDINGS_FILE = join(CORPUS_DIR, "findings.jsonl");
const TRIAGE_FILE = join(CORPUS_DIR, "triage.json");
const REPORT_FILE = join(CORPUS_DIR, "REPORT.md");

const HOOKWARDEN_BIN =
  process.env.HOOKWARDEN_BIN ?? join(REPO_ROOT, "packages", "cli", "bin", "cli.cjs");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { report: false, limit: null, providerFilter: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--report") out.report = true;
    else if (a === "--limit") out.limit = Number(args[++i]);
    else if (a === "--provider") out.providerFilter = args[++i];
    else throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function cloneAtSha(repo) {
  const dir = mkdtempSync(join(tmpdir(), `corpus-${repo.repo}-`));
  // shallow clone, then fetch + checkout pinned sha
  execFileSync("git", ["clone", "--quiet", "--depth", "50", repo.url, dir], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    execFileSync("git", ["-C", dir, "checkout", "--quiet", repo.sha], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    // shallow clone might not reach the pinned sha; fetch deeper.
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "--depth", "1000", "origin", repo.sha], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    execFileSync("git", ["-C", dir, "checkout", "--quiet", repo.sha], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  return dir;
}

function scan(dir) {
  // Run hookwarden in JSON mode. Exit code 1 = findings (expected), 0 = clean,
  // 2 = engine error (treat as zero-finding for corpus purposes; flag in report).
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      "node",
      [HOOKWARDEN_BIN, "scan", dir, "--format", "json", "--no-baseline", "--no-config"],
      {
        encoding: "utf-8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (err) {
    exitCode = err.status ?? -1;
    stdout = err.stdout?.toString() ?? "";
  }
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { engine_error: true, findings: [], exitCode };
  }
  return { engine_error: false, findings: parsed.findings ?? [], exitCode };
}

function runMeasure(args) {
  const repos = loadJson(REPOS_FILE, null);
  if (!repos) {
    console.error(`[measure-fp] ${REPOS_FILE} not found — run ./scripts/corpus/collect.mjs first`);
    process.exit(1);
  }
  const filtered = args.providerFilter
    ? repos.filter((r) => r.provider === args.providerFilter)
    : repos;
  const work = args.limit ? filtered.slice(0, args.limit) : filtered;

  mkdirSync(CORPUS_DIR, { recursive: true });
  const findingsOut = [];

  for (const repo of work) {
    process.stderr.write(
      `[measure-fp] ${repo.full_name}@${repo.sha.slice(0, 7)} (${repo.provider})\n`,
    );
    let dir = null;
    try {
      dir = cloneAtSha(repo);
      const result = scan(dir);
      for (const f of result.findings) {
        findingsOut.push({
          finding_id: `${repo.full_name}@${repo.sha.slice(0, 12)}#${f.fingerprint ?? `${f.rule_id}:${f.file_path}:${f.location?.line}`}`,
          provider: repo.provider,
          repo: repo.full_name,
          sha: repo.sha,
          rule_id: f.rule_id,
          severity: f.severity,
          verdict: f.verdict,
          file_path: f.file_path,
          line: f.location?.line ?? null,
          message: f.message,
        });
      }
      if (result.engine_error) {
        process.stderr.write(`[measure-fp]   engine error (exit ${result.exitCode}) — flagged\n`);
      }
    } catch (err) {
      process.stderr.write(`[measure-fp]   skip: ${err.message ?? err}\n`);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }

  const lines = findingsOut.map((f) => JSON.stringify(f));
  writeFileSync(FINDINGS_FILE, `${lines.join("\n")}\n`);
  process.stderr.write(`[measure-fp] wrote ${findingsOut.length} findings to ${FINDINGS_FILE}\n`);
}

function generateReport() {
  let lines = [];
  try {
    lines = readFileSync(FINDINGS_FILE, "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    console.error(`[measure-fp] ${FINDINGS_FILE} not found — run without --report first`);
    process.exit(1);
  }
  const findings = lines.map((l) => JSON.parse(l));
  const triage = loadJson(TRIAGE_FILE, {});

  // Bucket by severity.
  const buckets = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const f of findings) {
    const b = buckets[f.severity];
    if (b) b.push(f);
  }

  const summarize = (list) => {
    const total = list.length;
    const triaged = list.filter((f) => triage[f.finding_id] !== undefined);
    const tp = list.filter((f) => triage[f.finding_id] === "TP").length;
    const fp = list.filter((f) => triage[f.finding_id] === "FP").length;
    const na = list.filter((f) => triage[f.finding_id] === "NA").length;
    const untriaged = total - triaged.length;
    const fpRate = triaged.length > 0 ? (fp / (tp + fp)) * 100 : null;
    return { total, tp, fp, na, untriaged, fpRate };
  };

  const high = summarize([...buckets.critical, ...buckets.high]);
  const all = summarize(findings);

  const headline =
    high.fpRate !== null
      ? `${high.fpRate.toFixed(1)}% high+critical false-positive rate (${high.fp} FP across ${high.tp + high.fp} triaged)`
      : `Awaiting triage (${high.untriaged} high+critical findings to review)`;

  const out = [];
  out.push(`# Hookwarden corpus FP report`);
  out.push("");
  out.push(`**Generated:** ${new Date().toISOString()}`);
  out.push(`**Findings file:** ${FINDINGS_FILE}`);
  out.push(`**Triage file:** ${TRIAGE_FILE}`);
  out.push("");
  out.push(`## Headline`);
  out.push(`**${headline}**`);
  out.push("");
  out.push(`## By severity`);
  out.push(`| Severity | Total | TP | FP | NA | Untriaged | FP rate |`);
  out.push(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    const s = summarize(buckets[sev]);
    const rate = s.fpRate !== null ? `${s.fpRate.toFixed(1)}%` : "—";
    out.push(`| ${sev} | ${s.total} | ${s.tp} | ${s.fp} | ${s.na} | ${s.untriaged} | ${rate} |`);
  }
  out.push(
    `| **all** | ${all.total} | ${all.tp} | ${all.fp} | ${all.na} | ${all.untriaged} | ${all.fpRate !== null ? `${all.fpRate.toFixed(1)}%` : "—"} |`,
  );
  out.push("");
  out.push(`## Methodology`);
  out.push(
    `- Corpus: ${findings.length === 0 ? 0 : new Set(findings.map((f) => f.repo)).size} repositories pinned by SHA in repos.json.`,
  );
  out.push(`- Each repo cloned + scanned with default config (no --rules-dir, no baseline).`);
  out.push(
    `- TP / FP / NA decisions live in triage.json (manually populated; hash-keyed for re-run stability).`,
  );
  out.push(
    `- Headline metric is the high+critical FP rate — the number that matters for buyer-call credibility.`,
  );
  writeFileSync(REPORT_FILE, `${out.join("\n")}\n`);
  process.stdout.write(`${out.join("\n")}\n`);
  process.stderr.write(`\n[measure-fp] report written to ${REPORT_FILE}\n`);
}

function main() {
  const args = parseArgs();
  if (args.report) {
    generateReport();
    return;
  }
  runMeasure(args);
}

main();
