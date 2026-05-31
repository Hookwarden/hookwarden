#!/usr/bin/env node
// MCP-flavored bundle inspector for @hookwarden/mcp. Three layers:
//   1. Source-file regex scan over the published tarball — mirrors the CLI
//      analog at packages/cli/scripts/inspect-bundle.ts (Phase 4 D-73 single
//      source of truth: forbidden-deps lives only in packages/cli/scripts/
//      and we import the .ts source via tsx; no .js variant, no build step,
//      no fallback path).
//   2. package.json#dependencies allowlist scan — extends the CLI gate
//      because the MCP server pulls @modelcontextprotocol/sdk which itself
//      ships 15 HTTP-related transitive deps that hookwarden source NEVER
//      imports. The runtime claim is preserved by the source-file scan;
//      the deps-allowlist forces conscious planner review when a new
//      direct dep lands.
//   3. Tarball structural assertions — wasm/, build-manifest.json, LICENSE,
//      server.json must all survive from source tree to published tarball
//      (per RESEARCH §Pitfall 3).

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import pc from "picocolors";
import { extract } from "tar";

// IMPORT RULE (Plan 23-04 acceptance criteria): the literal specifier MUST
// be the .ts file. The script runs under tsx so the .ts extension resolves
// natively — no .js variant exists. Per Phase 4 D-73 the deny-list lives in
// exactly one place; duplicating it would create a second source of truth.
import { buildCategoryRegexes } from "../../cli/scripts/forbidden-deps.ts";

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

// Direct deps the MCP server is allowed to declare. Anything outside this
// set triggers a deps-allowlist violation and blocks release.
const HOOKWARDEN_OWN_PKGS = new Set([
  "@hookwarden/engine", // pure-functional rule evaluator (browser-safe per D-01)
  "@hookwarden/rules", // YAML rule pack + content-hash primitive
  "@hookwarden/canonical-json", // RFC 8785 JCS — pure, no-network; the verify_audit_chain byte-equality anchor (Plan 25-02)
]);

const SDK_TRANSITIVE_ALLOWLIST = new Set([
  // The @modelcontextprotocol/sdk ships its own HTTP transports (express,
  // hono, cors, jose, …) — exempted because the SDK ships them, not us;
  // hookwarden source never imports those modules, which the regex scan
  // verifies independently.
  "@modelcontextprotocol/sdk",
  // tree-sitter WASM runtime; no network.
  "web-tree-sitter",
  // citty: CLI flag parser (pure).
  "citty",
  // picocolors: terminal coloring (pure).
  "picocolors",
  // zod: schema validation for the MCP tool input.
  "zod",
]);

const ALLOWED_DEPS = new Set([...HOOKWARDEN_OWN_PKGS, ...SDK_TRANSITIVE_ALLOWLIST]);

// Required tarball entries — drop any one and the runtime fails (server boot
// reads build-manifest.json; loader.ts reads wasm/; MCP Registry rejects on
// missing server.json or LICENSE).
const REQUIRED_TARBALL_ENTRIES = [
  "wasm/tree-sitter-python.wasm",
  "dist/build-manifest.json",
  "LICENSE",
  "server.json",
];

function checkPackageJson(pkgPath: string): Violation[] {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const out: Violation[] = [];
  for (const name of FORBIDDEN_SCRIPTS) {
    if (pkg.scripts?.[name])
      out.push({ file: "package.json", category: "lifecycle-script", pattern: name });
  }
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!ALLOWED_DEPS.has(dep)) {
      out.push({
        file: "package.json",
        category: "deps-allowlist",
        pattern: `${dep} not on allowlist`,
      });
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function isTestPath(relPath: string): boolean {
  const norm = relPath.split(sep).join("/");
  return /^tests?\//.test(norm) || /\/tests?\//.test(norm);
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

function listTarballEntries(pkgDir: string): string[] {
  const out: string[] = [];
  function visit(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const s = statSync(full);
      if (s.isDirectory()) visit(full, rel);
      else out.push(rel);
    }
  }
  visit(pkgDir, "");
  return out;
}

function checkTarballContents(pkgDir: string): Violation[] {
  const entries = new Set(listTarballEntries(pkgDir));
  const out: Violation[] = [];
  for (const required of REQUIRED_TARBALL_ENTRIES) {
    if (!entries.has(required)) {
      out.push({
        file: "tarball",
        category: "missing-required-entry",
        pattern: required,
      });
    }
  }
  return out;
}

async function main(): Promise<number> {
  const cwd = process.cwd();
  const errors: Violation[] = [];

  errors.push(...checkPackageJson(join(cwd, "package.json")));

  const tmp = mkdtempSync(join(tmpdir(), "hookwarden-mcp-inspect-"));
  try {
    execSync(`npm pack --pack-destination "${tmp}"`, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const tgzList = readdirSync(tmp).filter((f) => f.endsWith(".tgz"));
    const tgz = tgzList[0];
    if (!tgz || tgzList.length > 1) {
      throw new Error(`expected exactly 1 .tgz in ${tmp}, found ${tgzList.length}`);
    }
    const extractDir = join(tmp, "extracted");
    mkdirSync(extractDir, { recursive: true });
    await extract({ file: join(tmp, tgz), cwd: extractDir });
    const pkgDir = join(extractDir, "package");

    errors.push(...checkTarballContents(pkgDir));

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
    console.error(pc.red("\n[BLOCKED] MCP bundle inspection FAILED:\n"));
    for (const e of errors) {
      console.error(pc.red(`  - [${e.category}] ${e.file} matches: ${e.pattern}`));
    }
    console.error(
      pc.yellow(
        "\nSee Plan 23-04 + RESEARCH §Pattern 7 / §Pitfall 1 / §Pitfall 3 / §Pitfall 6 for context.",
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
