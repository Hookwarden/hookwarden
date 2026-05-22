// Phase 8.2 D-05 + SC#12: engine purity gate verified at the dist layer.
//
// dependency-cruiser catches direct imports of @babel/traverse + @babel/generator,
// but the dist artifact is what users actually consume. This test greps the built
// engine output to catch any transitive or string-based leak.

import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE_DIST = path.resolve(__dirname, "../dist");
const RULES_PREDICATES_DIST = path.resolve(__dirname, "../../rules/dist/predicates");

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

function grepBabelMutationDeps(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  // Skip /// lines that are pure comments — match only real import/require statements.
  const lines = source.split("\n");
  const hits: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    for (const needle of ["@babel/traverse", "@babel/generator"]) {
      if (line.includes(needle)) {
        hits.push(`${needle} in ${path.relative(process.cwd(), file)}:${lineIdx + 1}`);
      }
    }
  }
  return hits;
}

describe("dist-grep engine-purity gate (D-05 + SC#12)", () => {
  it("packages/engine/dist contains no @babel/traverse or @babel/generator imports", () => {
    const files = collectJsFiles(ENGINE_DIST);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap(grepBabelMutationDeps);
    expect(hits).toEqual([]);
  });

  it("packages/rules/dist/predicates contains no @babel/traverse or @babel/generator imports", () => {
    const files = collectJsFiles(RULES_PREDICATES_DIST);
    // Predicates may not yet be built in CI's incremental cache; tolerate empty.
    const hits = files.flatMap(grepBabelMutationDeps);
    expect(hits).toEqual([]);
  });
});
