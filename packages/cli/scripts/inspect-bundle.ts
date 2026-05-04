#!/usr/bin/env node
// CLI-09: zero-outbound-network bundle gate. Phase 4: deny-list moved to forbidden-deps.ts (single source of truth).
// Phase 4 additions: undici, phin, superagent, analytics SDKs. Warning 10: skip test/ paths as defense in depth.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import pc from "picocolors";
import { extract } from "tar";
import { buildCategoryRegexes } from "./forbidden-deps.js";

type Violation = { file: string; category: string; pattern: string };

const FORBIDDEN_CATEGORIES = buildCategoryRegexes();

const FORBIDDEN_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preuninstall",
  "uninstall",
  "postuninstall",
];

function checkPackageJson(pkgPath: string): Violation[] {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  const out: Violation[] = [];
  for (const name of FORBIDDEN_SCRIPTS) {
    if (pkg.scripts?.[name])
      out.push({ file: "package.json", category: "lifecycle-script", pattern: name });
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Warning 10 — defense in depth: even if the package.json `files:` array drifts to include
 * test fixtures, do not regex-scan them. Test sources may LEGITIMATELY mention "axios" etc.
 * in a string assertion or a deny-list test fixture without that being a real network dep.
 * The pack-contents.test.ts unit test enforces the package.json invariant separately.
 */
function isTestPath(relPath: string): boolean {
  const norm = relPath.split(sep).join("/");
  return /^test\//.test(norm) || /\/test\//.test(norm);
}

function checkSourceFile(file: string, content: string): Violation[] {
  if (isTestPath(file)) return [];
  const stripped = stripComments(content);
  const out: Violation[] = [];
  for (const { category, pattern } of FORBIDDEN_CATEGORIES) {
    if (pattern.test(stripped)) out.push({ file, category, pattern: pattern.source });
  }
  return out;
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.slice(base.length + 1);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, base));
    else if (/\.(?:js|cjs|mjs|ts)$/.test(entry)) out.push(rel);
  }
  return out;
}

async function main(): Promise<number> {
  const cwd = process.cwd();
  const errors: Violation[] = [];

  errors.push(...checkPackageJson(join(cwd, "package.json")));

  const tmp = mkdtempSync(join(tmpdir(), "hookwarden-inspect-"));
  try {
    execSync(`npm pack --pack-destination "${tmp}"`, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const [tgz, ...extras] = readdirSync(tmp).filter((f) => f.endsWith(".tgz"));
    if (!tgz || extras.length > 0) {
      throw new Error(`expected exactly 1 .tgz in ${tmp}, found ${extras.length + (tgz ? 1 : 0)}`);
    }
    const extractDir = join(tmp, "extracted");
    mkdirSync(extractDir, { recursive: true });
    await extract({ file: join(tmp, tgz), cwd: extractDir });
    const pkgDir = join(extractDir, "package");
    const files = walk(pkgDir);
    for (const rel of files) {
      if (isTestPath(rel)) continue;
      const content = readFileSync(join(pkgDir, rel), "utf8");
      errors.push(...checkSourceFile(rel, content));
    }
  } finally {
    try {
      execSync(`rm -rf "${tmp}"`);
    } catch {
      /* best effort */
    }
  }

  if (errors.length > 0) {
    console.error(pc.red("\n[BLOCKED] Bundle inspection FAILED:\n"));
    for (const e of errors) {
      console.error(pc.red(`  - [${e.category}] ${e.file} matches: ${e.pattern}`));
    }
    console.error(
      pc.yellow(
        "\nSee CONTEXT.md decision D-19 + Phase 4 D-73 / forbidden-deps.ts for the deny-list.",
      ),
    );
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
