import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import { beforeAll, describe, expect, it } from "vitest";

const PKG_ROOT = join(__dirname, "..");
const ENGINE_DIST = join(PKG_ROOT, "dist");

// Each forbidden-symbol entry is its own test row. A single big loop hides
// which symbol leaked when the gate fires — splitting by pattern means a
// failing CI line says "fs leaked into engine dist", not "violations: [...]".
const FORBIDDEN_PATTERNS: Array<readonly [string, RegExp]> = [
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

// Anti-false-positive cases: legitimate code shapes that look superficially like
// a forbidden symbol but must NOT trip the regex. If a future broadening makes
// one of these match, a test fails before users see noise.
const REGEX_NARROWNESS_CASES: Array<readonly [string, RegExp, string, boolean]> = [
  // [pattern_name, regex, sample_code, expected_to_match]

  // crypto: bare globalThis.crypto.subtle / webcrypto.js imports must NOT match.
  [
    "crypto vs webcrypto property access",
    /["']node:crypto["']|require\(\s*["']crypto["']\s*\)|from\s+["']crypto["']/,
    "globalThis.crypto.subtle.digest('SHA-256', bytes)",
    false,
  ],
  [
    "crypto vs local webcrypto helper",
    /["']node:crypto["']|require\(\s*["']crypto["']\s*\)|from\s+["']crypto["']/,
    "import { sha256Hex } from './webcrypto.js';",
    false,
  ],
  [
    "crypto matches real node:crypto",
    /["']node:crypto["']|require\(\s*["']crypto["']\s*\)|from\s+["']crypto["']/,
    "import { createHash } from 'node:crypto';",
    true,
  ],

  // path: a getPath() function call or `path.subPath` property must NOT match the
  // module-import regex (which only matches string-quoted module specifiers).
  [
    "path vs getPath() method",
    /["']node:path["']|require\(\s*["']path["']\s*\)|from\s+["']path["']/,
    "const p = getPath();",
    false,
  ],
  [
    "path vs local path utility",
    /["']node:path["']|require\(\s*["']path["']\s*\)|from\s+["']path["']/,
    "import { resolve } from './path-utils.js';",
    false,
  ],
  [
    "path matches real node:path",
    /["']node:path["']|require\(\s*["']path["']\s*\)|from\s+["']path["']/,
    "import * as path from 'node:path';",
    true,
  ],

  // url: a URL constructor / WHATWG URL global must NOT match the import regex.
  [
    "url vs WHATWG URL global",
    /["']node:url["']|require\(\s*["']url["']\s*\)|from\s+["']url["']/,
    "const u = new URL('https://example.com');",
    false,
  ],
  [
    "url matches real node:url import",
    /["']node:url["']|require\(\s*["']url["']\s*\)|from\s+["']url["']/,
    "import { fileURLToPath } from 'node:url';",
    true,
  ],

  // process.env: legitimate `process.envelope` (hypothetical naming) must NOT match.
  ["process.env vs process.envelope", /\bprocess\.env\b/, "ctx.process.envelope = payload;", false],
  [
    "process.env matches real env read",
    /\bprocess\.env\b/,
    "const x = process.env.NODE_ENV;",
    true,
  ],

  // globalThis.fetch: `globalThis.fetcher` custom property must NOT match.
  [
    "globalThis.fetch vs custom fetcher",
    /\bglobalThis\.fetch\b/,
    "globalThis.fetcher.get(url);",
    false,
  ],
  [
    "globalThis.fetch matches real fetch global",
    /\bglobalThis\.fetch\b/,
    "const r = await globalThis.fetch(url);",
    true,
  ],
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

  // One named test per forbidden symbol — failure pinpoints which one leaked.
  describe("per-symbol forbidden-import gate", () => {
    it.each(
      FORBIDDEN_PATTERNS,
    )("no compiled .js file imports %s", (name: string, pattern: RegExp) => {
      const files = globSync("**/*.js", { cwd: ENGINE_DIST, absolute: true });
      const violations: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (pattern.test(stripped)) {
          violations.push(`${file.replace(`${ENGINE_DIST}/`, "")} contains forbidden ${name}`);
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  });

  // One named test per forbidden runtime dep — failure pinpoints which dep
  // snuck into the engine's package.json.
  describe("per-dep package.json gate", () => {
    it.each(
      FORBIDDEN_RUNTIME_DEPS,
    )("engine package.json does not declare %s as a runtime dep", (dep: string) => {
      const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
        readonly dependencies?: Record<string, string>;
      };
      const deps = pkg.dependencies ?? {};
      expect(deps[dep], `dependency '${dep}' must not be in engine runtime deps`).toBeUndefined();
    });
  });

  // Regex narrowness — assert each pattern doesn't false-positive on legitimate
  // code shapes. Stops "broaden the regex" PRs from accidentally re-introducing
  // noise the engine team already fixed (e.g. issue #10 for globalThis.crypto).
  describe("regex narrowness (anti-false-positive)", () => {
    it.each(
      REGEX_NARROWNESS_CASES,
    )("%s", (_name: string, pattern: RegExp, sample: string, expectedMatch: boolean) => {
      expect(pattern.test(sample)).toBe(expectedMatch);
    });
  });

  // ─── Evasion-vector guards (auditor-facing supply-chain hardening) ───────
  // The per-symbol grep above catches static `import 'fs'` and `require('fs')`.
  // The vectors below are real escape hatches the static grep misses on its own.

  describe("evasion-vector guards", () => {
    it("no .js.map file in engine/dist contains inline sourcesContent (source-leak guard)", () => {
      // If tsconfig is ever set to inlineSources or sourceMap with sourcesContent,
      // the source files (including any forbidden symbols in pre-erasure TypeScript)
      // get embedded in the .js.map shipped to npm consumers. tsc's default
      // omits sourcesContent — this test fires if that default ever changes.
      const mapFiles = globSync("**/*.js.map", { cwd: ENGINE_DIST, absolute: true });
      const leaks: string[] = [];
      for (const mapPath of mapFiles) {
        const parsed = JSON.parse(readFileSync(mapPath, "utf8")) as {
          readonly sourcesContent?: ReadonlyArray<unknown>;
        };
        if (parsed.sourcesContent !== undefined) {
          leaks.push(`${mapPath.replace(`${ENGINE_DIST}/`, "")} has inline sourcesContent`);
        }
      }
      expect(leaks, leaks.join("\n")).toEqual([]);
    });

    it("no .js.map file in engine/dist references any forbidden runtime dep", () => {
      // Defense in depth: even if sourcesContent is empty, the `sources:` paths
      // and any other metadata should not reference forbidden deps. Catches
      // tsconfig misconfigurations that point sources at e.g. node_modules/axios.
      const mapFiles = globSync("**/*.js.map", { cwd: ENGINE_DIST, absolute: true });
      const leaks: string[] = [];
      for (const mapPath of mapFiles) {
        const content = readFileSync(mapPath, "utf8");
        for (const dep of FORBIDDEN_RUNTIME_DEPS) {
          // Match the dep as a path segment to avoid false positives on names
          // like "axios-mock-adapter" matching "axios".
          const pattern = new RegExp(`["'/]${dep.replace("-", "\\-")}["'/]`);
          if (pattern.test(content)) {
            leaks.push(`${mapPath.replace(`${ENGINE_DIST}/`, "")} references ${dep}`);
          }
        }
      }
      expect(leaks, leaks.join("\n")).toEqual([]);
    });

    it("no compiled .js uses string-concatenated dynamic require to evade the static grep", () => {
      // The per-symbol grep catches `require('axios')` but misses
      // `require("axi" + "os")` because it greps for string-quoted module
      // specifiers. This test catches the concatenation pattern explicitly.
      const files = globSync("**/*.js", { cwd: ENGINE_DIST, absolute: true });
      const violations: string[] = [];
      // Match: require(  "..."  +  "..."  ) or import(  "..."  +  "..."  )
      // Allows whitespace around tokens; the key signal is two adjacent string
      // literals joined by `+` inside a require/import call.
      const evasionPattern = /(?:require|import)\s*\(\s*["'][^"']*["']\s*\+\s*["'][^"']*["']/;
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (evasionPattern.test(stripped)) {
          violations.push(file.replace(`${ENGINE_DIST}/`, ""));
        }
      }
      expect(
        violations,
        `string-concatenated dynamic require detected: ${violations.join(", ")}`,
      ).toEqual([]);
    });

    it("no compiled .js uses computed-property dynamic require (variable-based)", () => {
      // `const m = "axios"; require(m)` — even harder to catch since `m`
      // could be set anywhere. Pattern-match for the shape: require(IDENT)
      // where IDENT is a bare identifier, not a string literal. This is
      // legitimate in framework code (Express does it) so we only flag
      // computed requires in modules that have other red flags. For the
      // engine, the convention is ZERO dynamic requires of any kind — the
      // engine is pure-functional and synchronous-imports-only by design.
      const files = globSync("**/*.js", { cwd: ENGINE_DIST, absolute: true });
      const violations: string[] = [];
      const computedRequirePattern = /\brequire\s*\(\s*[A-Za-z_]\w*\s*\)/;
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (computedRequirePattern.test(stripped)) {
          violations.push(file.replace(`${ENGINE_DIST}/`, ""));
        }
      }
      expect(
        violations,
        `computed-property dynamic require in engine dist: ${violations.join(", ")}`,
      ).toEqual([]);
    });

    it("engine package.json declares no forbidden deps in peerDependencies either", () => {
      // The existing per-dep gate covers `dependencies`. peerDependencies is
      // a separate field that npm install ALSO satisfies — a forbidden dep
      // declared as peer would still arrive in the consumer's node_modules.
      const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
        readonly peerDependencies?: Record<string, string>;
      };
      const peers = pkg.peerDependencies ?? {};
      const forbiddenPeers = Object.keys(peers).filter((d) => FORBIDDEN_RUNTIME_DEPS.includes(d));
      expect(
        forbiddenPeers,
        `forbidden deps in peerDependencies: ${forbiddenPeers.join(", ")}`,
      ).toEqual([]);
    });

    it("engine package.json declares no forbidden deps in optionalDependencies either", () => {
      // Same rationale as peerDependencies: optionalDependencies still get
      // installed by default; npm only treats them as soft-fail-on-install.
      const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
        readonly optionalDependencies?: Record<string, string>;
      };
      const opt = pkg.optionalDependencies ?? {};
      const forbiddenOpt = Object.keys(opt).filter((d) => FORBIDDEN_RUNTIME_DEPS.includes(d));
      expect(
        forbiddenOpt,
        `forbidden deps in optionalDependencies: ${forbiddenOpt.join(", ")}`,
      ).toEqual([]);
    });
  });
});
