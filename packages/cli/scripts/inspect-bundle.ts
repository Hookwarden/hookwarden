#!/usr/bin/env node
// packages/cli/scripts/inspect-bundle.ts -- implements D-19.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { extract } from "tar";

type Violation = { file: string; category: string; pattern: string };

// Match three import shapes:
//   require("lib")           -> 'require\(\s*'
//   from "lib"               -> 'from\s+'   (covers `import x from "lib"`, `import {a} from "lib"`, `import * as x from "lib"`)
//   import "lib"             -> 'import\s+' (bare side-effect import — covers `import "lib";`)
const FORBIDDEN_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  {
    category: "network-builtin",
    pattern:
      /\b(?:require\(\s*|from\s+|import\s+)["'](?:node:)?(?:http|https|net|dgram|tls|dns)["']/,
  },
  {
    category: "network-http-client",
    pattern:
      /\b(?:require\(\s*|from\s+|import\s+)["'](?:node-fetch|axios|got|undici|cross-fetch|isomorphic-fetch|ky|wretch|phin|needle|request)["']/,
  },
  {
    category: "analytics-sdk",
    pattern:
      /\b(?:require\(\s*|from\s+|import\s+)["'](?:@sentry\/[\w-]+|posthog-[\w-]+|@datadog\/[\w-]+|mixpanel|@amplitude\/[\w-]+|amplitude|@segment\/[\w-]+|analytics-node|heap-node|@logsnag\/[\w-]+|loggly-jslogger|rollbar|honeycomb-beeline|appsignal|bugsnag|@bugsnag\/[\w-]+)["']/,
  },
];

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

function checkSourceFile(file: string, content: string): Violation[] {
  const stripped = stripComments(content);
  const out: Violation[] = [];
  for (const { category, pattern } of FORBIDDEN_PATTERNS) {
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
    console.error(pc.yellow("\nSee CONTEXT.md decision D-19 for the forbidden list."));
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
