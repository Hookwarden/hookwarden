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

// Phase 8.2 D-02: codegen routine registry placeholder.
// Plan 02 wave 1 wires the lookup; Plan 06 (wave 3) replaces this with an
// import from `@hookwarden/rules` exposing ALL_CODEGEN_ROUTINES.
//
// Empty set short-circuits the check: when the set is empty the codegen
// reference passes through unvalidated, so this plan does not block any
// YAML that declares a codegen ID. Once Plan 06 populates the set, every
// rule that references an unknown codegen routine fails to load.
export const KNOWN_CODEGEN_IDS_PLACEHOLDER: ReadonlySet<string> = new Set();

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

/**
 * Per D-04 (Phase 8.2): every rule must declare a `fix:` block (or `fix: null`).
 *
 * B4 — in Plan 02 wave 1, `fix` is OPTIONAL in the schema; Plan 11 wave 7 tightens
 * to required after every YAML carries the key. The schema validator normalizes
 * undefined → null at the boundary so RuleSet consumers can rely on `fix !== undefined`.
 *
 * The KNOWN_CODEGEN_IDS_PLACEHOLDER export is the registry-lookup hook; it remains
 * empty in this plan (so the codegen-reference check is a no-op) and is replaced
 * by ALL_CODEGEN_ROUTINES in Phase 8.2 Plan 06 (wave 3).
 */
export async function loadRulesFromDir(options: LoadRulesOptions = {}): Promise<RuleSet> {
  // Default path: use the build-time-bundled rule documents from @hookwarden/rules.
  // This is the canonical path for both Node + npm consumers AND Bun --compile output;
  // no filesystem access, no YAML parsing, no node_modules resolution. Phase 4.2 DC-19.
  const ruleSet =
    options.rulesDir === undefined
      ? await loadRuleSet({
          rule_documents: BUNDLED_RULE_DOCUMENTS.map((entry) => entry.doc),
          predicates: ALL_PREDICATES,
          providers: PROVIDER_CATALOG,
          rule_pack_version: RULES_PACK_VERSION,
        })
      : await (async () => {
          // --rules-dir override: dev-only path that loads YAML from the supplied directory.
          // Failure here is an error, not a fallback to the bundle.
          const root = path.resolve(options.rulesDir as string);
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
        })();

  // Phase 8.2 D-02: validate codegen references against the known-routine set.
  // The placeholder set is empty in this plan; Plan 06 swaps it for ALL_CODEGEN_ROUTINES.
  if (KNOWN_CODEGEN_IDS_PLACEHOLDER.size > 0) {
    const unknown: string[] = [];
    for (const rule of ruleSet.rules) {
      const codegen = rule.fix?.codegen;
      if (codegen !== undefined && codegen !== null && !KNOWN_CODEGEN_IDS_PLACEHOLDER.has(codegen)) {
        unknown.push(`${rule.rule_id}: codegen '${codegen}'`);
      }
    }
    if (unknown.length > 0) {
      throw new Error(`unknown codegen routine(s): ${unknown.join("; ")}`);
    }
  }

  return ruleSet;
}
