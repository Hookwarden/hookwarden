import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import { beforeAll, describe, expect, it } from "vitest";

const PKG_ROOT = join(__dirname, "..");
const ENGINE_DIST = join(PKG_ROOT, "dist");

const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ["node:fs", /["']node:fs(?:\/promises)?["']/],
  ["fs", /\brequire\(\s*["']fs(?:\/promises)?["']\s*\)|from\s+["']fs(?:\/promises)?["']/],
  ["http", /["']node:http["']|require\(\s*["']http["']\s*\)|from\s+["']http["']/],
  ["https", /["']node:https["']|require\(\s*["']https["']\s*\)|from\s+["']https["']/],
  ["net", /["']node:net["']|require\(\s*["']net["']\s*\)|from\s+["']net["']/],
  [
    "child_process",
    /["']node:child_process["']|require\(\s*["']child_process["']\s*\)|from\s+["']child_process["']/,
  ],
  ["process.cwd", /\bprocess\.cwd\s*\(/],
  ["process.env", /\bprocess\.env\b/],
  ["globalThis.fetch", /\bglobalThis\.fetch\b/],
  ["axios", /["']axios["']/],
  ["node-fetch", /["']node-fetch["']/],
  ["undici", /["']undici["']/],
  ["got", /["']got["']/],
  // Plan 02-09 extensions — Plan 02 uses globalThis.crypto.subtle (D-02), so the `crypto` regex
  // matches ONLY string-quoted module references; bare `globalThis.crypto.subtle` MUST NOT trigger
  // (issue #10). Same shape for path/url.
  ["crypto", /["']node:crypto["']|require\(\s*["']crypto["']\s*\)|from\s+["']crypto["']/],
  ["path", /["']node:path["']|require\(\s*["']path["']\s*\)|from\s+["']path["']/],
  ["url", /["']node:url["']|require\(\s*["']url["']\s*\)|from\s+["']url["']/],
];

const FORBIDDEN_RUNTIME_DEPS: ReadonlyArray<string> = [
  "axios",
  "node-fetch",
  "got",
  "undici",
  "cross-fetch",
  "isomorphic-fetch",
  "ky",
  "wretch",
  "phin",
  "needle",
  "request",
  "graceful-fs",
  "fs-extra",
  "chokidar",
  "glob",
  "fast-glob",
  "tinyglobby",
];

beforeAll(() => {
  // Pitfall #3 mitigation: force a fresh build so we never grep stale output.
  execSync("pnpm exec tsc --build --force", { cwd: join(PKG_ROOT, "..", "..") });
  if (!existsSync(ENGINE_DIST)) {
    throw new Error(`Engine dist directory missing after build: ${ENGINE_DIST}`);
  }
});

describe("engine purity (compiled output grep)", () => {
  it("dist/ contains at least one .js file (anti-stale-dist guard)", () => {
    const files = globSync("**/*.js", { cwd: ENGINE_DIST, absolute: true });
    expect(files.length).toBeGreaterThan(0);
  });

  it("every compiled .js file is free of forbidden symbols", () => {
    const files = globSync("**/*.js", { cwd: ENGINE_DIST, absolute: true });
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Strip block and line comments first so doc text doesn't false-positive.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const [name, pattern] of FORBIDDEN_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(
            `${file.replace(`${ENGINE_DIST}/`, "")} contains forbidden symbol: ${name}`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("engine package.json declares no forbidden runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      readonly dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const present = Object.keys(deps).filter((d) => FORBIDDEN_RUNTIME_DEPS.includes(d));
    expect(present, `forbidden runtime deps present: ${present.join(", ")}`).toEqual([]);
  });

  it("extended FORBIDDEN_PATTERNS regex does not false-trigger on globalThis.crypto.subtle (issue #10)", () => {
    // Plan 02 ships /src/findings/webcrypto.ts which uses `globalThis.crypto.subtle.digest(...)`.
    // The crypto pattern intentionally matches only string-quoted module references; this test
    // asserts the regex is narrow enough that the WebCrypto API usage in the engine source does
    // not get flagged. If this test fails after the regex is broadened, narrow it again.
    const cryptoPattern = /["']node:crypto["']|require\(\s*["']crypto["']\s*\)|from\s+["']crypto["']/;
    expect(cryptoPattern.test("globalThis.crypto.subtle.digest('SHA-256', bytes)")).toBe(false);
    expect(cryptoPattern.test("import { sha256Hex } from './webcrypto.js';")).toBe(false);
    // And it DOES still match real Node-crypto imports.
    expect(cryptoPattern.test("import { createHash } from 'node:crypto';")).toBe(true);
    expect(cryptoPattern.test("const c = require('crypto');")).toBe(true);
  });
});
