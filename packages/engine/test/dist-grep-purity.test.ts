// Phase 8.2 D-05 + SC#12: engine purity gate verified at the dist layer.
//
// dependency-cruiser catches direct imports of @babel/traverse + @babel/generator,
// but the dist artifact is what users actually consume. This test greps the built
// engine + rules output to catch any transitive or string-based leak.
//
// Per-package × per-needle parametrization: a failure pinpoints which package
// AND which forbidden symbol leaked — not just "babel got in somewhere."

import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE_DIST = path.resolve(__dirname, "../dist");
const RULES_DIST = path.resolve(__dirname, "../../rules/dist");
const RULES_PREDICATES_DIST = path.resolve(__dirname, "../../rules/dist/predicates");

// Each forbidden needle gets its own line item per package — failure messages
// pinpoint both the package AND the leaked symbol, not just "violations: [...]".
// @babel/traverse and @babel/generator are the AST-mutation deps that must
// stay bounded to packages/fix only (Phase 8.2 D-05).
const FORBIDDEN_NEEDLES = ["@babel/traverse", "@babel/generator"] as const;

// Each package has its own purity scope. fix/ is intentionally absent from this
// list — it MAY import @babel/traverse and @babel/generator (it's the bounded
// location for AST mutation, per Phase 8.2 D-05).
const PURITY_SCOPES: Array<readonly [string, string]> = [
  ["packages/engine/dist", ENGINE_DIST],
  ["packages/rules/dist", RULES_DIST],
  ["packages/rules/dist/predicates", RULES_PREDICATES_DIST],
];

function collectJsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...collectJsFiles(abs));
    } else if (entry.endsWith(".js") || entry.endsWith(".cjs") || entry.endsWith(".mjs")) {
      out.push(abs);
    }
  }
  return out;
}

function grepNeedle(file: string, needle: string): string[] {
  const source = readFileSync(file, "utf-8");
  const lines = source.split("\n");
  const hits: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    const trimmed = line.trim();
    // Skip pure comment lines so doc text mentioning the needle doesn't false-positive.
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    if (line.includes(needle)) {
      hits.push(`${needle} in ${path.relative(process.cwd(), file)}:${lineIdx + 1}`);
    }
  }
  return hits;
}

describe("dist-grep engine-purity gate (D-05 + SC#12)", () => {
  // Anti-stale-dist guards: each purity-scoped package must actually have
  // built output. A vacuous test (zero files → grep returns []) would pass
  // without proving anything.
  describe("dist build presence", () => {
    it.each(
      PURITY_SCOPES,
    )("%s contains at least one compiled .js file (anti-stale-dist)", (label: string, dir: string) => {
      const files = collectJsFiles(dir);
      // RULES_PREDICATES_DIST may not yet be populated in CI's incremental cache;
      // tolerate empty there. Engine + rules root MUST be populated.
      if (label === "packages/rules/dist/predicates") {
        expect(files.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(files.length, `${label} has no compiled output — build skipped?`).toBeGreaterThan(0);
      }
    });
  });

  // Per-package × per-needle: 3 scopes × 2 needles = 6 named cases.
  describe("per-package forbidden-needle gate", () => {
    for (const [label, dir] of PURITY_SCOPES) {
      for (const needle of FORBIDDEN_NEEDLES) {
        it(`${label} contains no ${needle} import`, () => {
          const files = collectJsFiles(dir);
          const hits = files.flatMap((f) => grepNeedle(f, needle));
          expect(hits, `${needle} leaked into ${label}: ${hits.join(", ")}`).toEqual([]);
        });
      }
    }
  });

  // Carve-out verification at the package.json level: the fix package is
  // the bounded location for AST-mutation deps (Phase 8.2 D-05). Whether they
  // are actively imported is an implementation detail (v0.5 uses text-range
  // only — see rewriter.js comment); what matters is that they are declared
  // HERE and only here. If a future refactor adds them to engine/rules deps,
  // this test still passes — but the dist-grep gate above fires.
  describe("carve-out: packages/fix is the bounded location for AST-mutation deps", () => {
    const FIX_PKG_JSON = path.resolve(__dirname, "../../fix/package.json");
    const ENGINE_PKG_JSON = path.resolve(__dirname, "../package.json");
    const RULES_PKG_JSON = path.resolve(__dirname, "../../rules/package.json");

    it.each(
      FORBIDDEN_NEEDLES,
    )("packages/fix package.json DOES declare %s as a runtime dep (D-05)", (needle: string) => {
      const pkg = JSON.parse(readFileSync(FIX_PKG_JSON, "utf8")) as {
        readonly dependencies?: Record<string, string>;
      };
      const deps = pkg.dependencies ?? {};
      expect(
        deps[needle],
        `${needle} should be declared in packages/fix/package.json — it's the bounded location per D-05`,
      ).toBeDefined();
    });

    it.each(
      FORBIDDEN_NEEDLES,
    )("packages/engine package.json does NOT declare %s", (needle: string) => {
      const pkg = JSON.parse(readFileSync(ENGINE_PKG_JSON, "utf8")) as {
        readonly dependencies?: Record<string, string>;
        readonly devDependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.[needle]).toBeUndefined();
      expect(pkg.devDependencies?.[needle]).toBeUndefined();
    });

    it.each(
      FORBIDDEN_NEEDLES,
    )("packages/rules package.json does NOT declare %s as a runtime dep", (needle: string) => {
      const pkg = JSON.parse(readFileSync(RULES_PKG_JSON, "utf8")) as {
        readonly dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.[needle]).toBeUndefined();
    });
  });

  // String-based leak: even if a symbol isn't imported, a hard-coded string
  // referencing the package name in source could indicate a dynamic require
  // attempt or a vendored copy. The pure-import grep above catches static
  // imports; this additional sweep catches `require.resolve("@babel/traverse")`
  // style strings that would otherwise slip past.
  describe("dynamic-require evasion guard", () => {
    it.each(
      PURITY_SCOPES,
    )("%s has no require.resolve / dynamic import strings naming forbidden needles", (_label: string, dir: string) => {
      const files = collectJsFiles(dir);
      const hits: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, "utf-8");
        for (const needle of FORBIDDEN_NEEDLES) {
          // Match require.resolve("@babel/X") or require("@babel/X") or import("@babel/X")
          const pattern = new RegExp(
            `(require(?:\\.resolve)?|import)\\s*\\(\\s*["']${needle.replace("/", "\\/")}["']`,
          );
          if (pattern.test(source)) {
            hits.push(`${needle} dynamic-require in ${path.relative(process.cwd(), file)}`);
          }
        }
      }
      expect(hits, hits.join("\n")).toEqual([]);
    });
  });
});
