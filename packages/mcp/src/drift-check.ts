// MCP-04 structural integrity gate. Compares the build-time pinned
// engine + rules versions (and rules content-hash) against the runtime-resolved
// equivalents from the installed package tree. Per D-23-13 there is NO env-var
// opt-out — a drifted install is always either rejected at boot (server.ts)
// or surfaced as `isError: true` at call-time (scan-handler.ts).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINE_VERSION } from "@hookwarden/engine";
import {
  BUNDLED_RULE_DOCUMENTS,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
  computeContentHash,
  validateRuleDocument,
} from "@hookwarden/rules";

import type { BuildManifest, DriftError } from "./types.js";

const REINSTALL = "npm i -g @hookwarden/mcp@latest";
const RATIONALE = {
  engine_version:
    "Rule verdicts depend on engine version; running with a different engine than the one tested at release risks stale-rule-pack false confidence.",
  rules_version:
    "Rule-pack content shipped with this MCP server has been replaced with a different version; verdicts may not match what was tested at release.",
  rules_content:
    "Bundled rule YAML content has changed since release; reinstalling realigns the rule pack with the engine.",
} as const;

// Read the build-manifest written at `pnpm build` / `pnpm prepack` time
// (Plan 23-03 emits it). Path-walks one level up from the compiled
// `dist/drift-check.js` so the same logic works in dev (`src/`) and post-build.
export async function loadBuildManifest(): Promise<BuildManifest> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.join(__dirname, "..", "build-manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as BuildManifest;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `hookwarden-mcp: build-manifest missing at ${manifestPath} — package not properly built; reinstall via ${REINSTALL}`,
      );
    }
    throw err;
  }
}

// Returns null when nothing has drifted. Returns the structured DriftError
// payload (4 required fields per VALIDATION line 919) on mismatch. No
// env-var opt-out per D-23-13.
export async function checkDrift(manifest: BuildManifest): Promise<DriftError | null> {
  if (ENGINE_VERSION !== manifest.engine.version) {
    return {
      error: "engine_drift",
      component: "engine",
      pinned: manifest.engine.version,
      current: ENGINE_VERSION,
      suggestion: REINSTALL,
      rationale: RATIONALE.engine_version,
    };
  }
  if (RULES_PACK_VERSION !== manifest.rules.version) {
    return {
      error: "rules_drift",
      component: "rules",
      pinned: manifest.rules.version,
      current: RULES_PACK_VERSION,
      suggestion: REINSTALL,
      rationale: RATIONALE.rules_version,
    };
  }
  const parsed = BUNDLED_RULE_DOCUMENTS.map((entry) => validateRuleDocument(entry.doc));
  const currentHash = await computeContentHash(PROVIDER_CATALOG, parsed);
  if (currentHash !== manifest.rules.content_hash) {
    return {
      error: "rules_drift",
      component: "rules",
      pinned: manifest.rules.content_hash,
      current: currentHash,
      suggestion: REINSTALL,
      rationale: RATIONALE.rules_content,
    };
  }
  return null;
}
