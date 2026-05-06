// CLI is the I/O boundary (D-01, D-03): the engine never reads YAML; the CLI parses YAML +
// catalog and hands the engine a pre-parsed RuleSet object.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RuleSet } from "@hookwarden/engine";
import {
  ALL_PREDICATES,
  BUNDLED_RULE_DOCUMENTS,
  loadRuleSet,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
} from "@hookwarden/rules";
import { load as parseYaml } from "js-yaml";

export interface LoadRulesOptions {
  // Override the bundled rule pack location. D-48 ships --rules-dir as a dev-only flag.
  // When set, the on-disk YAML files at that path are loaded and parsed, ignoring the
  // build-time-bundled rule documents. When unset, the bundled rules are used directly,
  // which works in both Node + npm and Bun --compile (no fs reads, no YAML parsing at
  // runtime, no `node_modules/@hookwarden/rules/rules/*.yaml` lookup).
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

export async function loadRulesFromDir(options: LoadRulesOptions = {}): Promise<RuleSet> {
  // Default path: use the build-time-bundled rule documents from @hookwarden/rules.
  // This is the canonical path for both Node + npm consumers AND Bun --compile output;
  // no filesystem access, no YAML parsing, no node_modules resolution. Phase 4.2 DC-19.
  if (options.rulesDir === undefined) {
    return loadRuleSet({
      rule_documents: BUNDLED_RULE_DOCUMENTS.map((entry) => entry.doc),
      predicates: ALL_PREDICATES,
      providers: PROVIDER_CATALOG,
      rule_pack_version: RULES_PACK_VERSION,
    });
  }

  // --rules-dir override: dev-only path that loads YAML from the supplied directory.
  // Failure here is an error, not a fallback to the bundle.
  const root = path.resolve(options.rulesDir);
  const yamlFiles = (await findYamlFiles(root)).sort();
  if (yamlFiles.length === 0) {
    throw new Error(`Could not locate rule pack. Searched: ${root}`);
  }
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
