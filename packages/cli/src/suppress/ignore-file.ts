// D-62 .hookwardenignore: gitignore syntax with negation. matchesAll() exposes all matching positive
// patterns for D-67 stale detection. Reuses the `ignore` package (same as Phase 3 walker).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";

export interface IgnoreFilter {
  readonly matches: (filePath: string) => string | null;
  readonly matchesAll: (filePath: string) => ReadonlyArray<string>;
  readonly patterns: ReadonlyArray<string>;
}

export async function loadHookwardenIgnore(rootPath: string): Promise<IgnoreFilter | null> {
  const filePath = path.join(rootPath, ".hookwardenignore");
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const rawLines = content.split(/\r?\n/);
  const patterns: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    patterns.push(trimmed);
  }

  const fullIgnore: Ignore = ignore().add(patterns);
  const positivePatterns = patterns.filter((p) => !p.startsWith("!"));
  const singleMatchers: ReadonlyArray<{ pattern: string; matcher: Ignore }> = positivePatterns.map(
    (pattern) => ({
      pattern,
      matcher: ignore().add(pattern),
    }),
  );

  const normalize = (p: string): string => p.split(path.sep).join("/");

  return {
    patterns,
    matches: (input: string): string | null => {
      const rel = normalize(input);
      if (!fullIgnore.ignores(rel)) return null;
      for (let i = singleMatchers.length - 1; i >= 0; i -= 1) {
        const sm = singleMatchers[i];
        if (sm?.matcher.ignores(rel)) return sm.pattern;
      }
      return null;
    },
    matchesAll: (input: string): ReadonlyArray<string> => {
      const rel = normalize(input);
      if (!fullIgnore.ignores(rel)) return [];
      const matched: string[] = [];
      for (const sm of singleMatchers) {
        if (sm.matcher.ignores(rel)) matched.push(sm.pattern);
      }
      return matched;
    },
  };
}
