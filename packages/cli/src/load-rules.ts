// CLI is the I/O boundary (D-01, D-03): the engine never reads YAML; the CLI parses YAML +
// catalog and hands the engine a pre-parsed RuleSet object.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleSet } from "@hookwarden/engine";
import {
  ALL_PREDICATES,
  loadRuleSet,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
} from "@hookwarden/rules";
import { load as parseYaml } from "js-yaml";

export interface LoadRulesOptions {
  // Override the bundled rule pack location. D-48 ships --rules-dir as a dev-only flag.
  readonly rulesDir?: string;
}

async function findYamlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await findYamlFiles(abs);
      for (const s of sub) out.push(s);
    } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      out.push(abs);
    }
  }
  return out;
}

// W-6: relative-path resolution `../../rules/rules` is fragile under npm flat-install layouts
// (npm hoists workspace siblings to <root>/node_modules/@hookwarden/rules/, breaking the
// relative `..` walk from the CLI's installed location). Use the package-resolver protocol:
//
//   1. Prefer `import.meta.resolve("@hookwarden/rules/package.json")` (Node 20.6+ stable).
//   2. Fall back to `createRequire` for runtimes without `import.meta.resolve`.
//
// CR-02 (review): converting `file://…` URLs MUST use `fileURLToPath` from `node:url`.
// `new URL(pkgUrl).pathname` is broken on Windows — it yields `/C:/…` which `path.resolve`
// then mishandles. `fileURLToPath` round-trips correctly across platforms.
export function resolveDefaultRulesDir(): string {
  const resolver = (import.meta as { resolve?: (s: string) => string }).resolve;
  if (typeof resolver === "function") {
    try {
      const pkgUrl = resolver("@hookwarden/rules/package.json");
      if (pkgUrl) {
        const pkgPath = fileURLToPath(pkgUrl);
        return path.resolve(path.dirname(pkgPath), "rules");
      }
    } catch {
      // fall through
    }
  }
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve("@hookwarden/rules/package.json");
  return path.resolve(path.dirname(pkgPath), "rules");
}

export async function loadRulesFromDir(options: LoadRulesOptions = {}): Promise<RuleSet> {
  // When the caller explicitly supplies --rules-dir, that path is authoritative — failure to
  // find rules there is an error, not a trigger to fall back to the bundled location.
  // Without --rules-dir, try the resolved default first, then the workspace dev path.
  const candidates: string[] = [];
  if (options.rulesDir) {
    candidates.push(path.resolve(options.rulesDir));
  } else {
    candidates.push(resolveDefaultRulesDir());
    candidates.push(path.resolve(process.cwd(), "packages/rules/rules"));
  }

  let yamlFiles: string[] = [];
  for (const c of candidates) {
    yamlFiles = await findYamlFiles(c);
    if (yamlFiles.length > 0) break;
  }
  if (yamlFiles.length === 0) {
    throw new Error(`Could not locate rule pack. Searched: ${candidates.join(", ")}`);
  }
  yamlFiles.sort();
  const docs: unknown[] = [];
  for (const f of yamlFiles) {
    const content = await fs.readFile(f, "utf-8");
    docs.push(parseYaml(content));
  }
  return loadRuleSet({
    rule_documents: docs,
    predicates: ALL_PREDICATES,
    providers: PROVIDER_CATALOG,
    rule_pack_version: RULES_PACK_VERSION,
  });
}
