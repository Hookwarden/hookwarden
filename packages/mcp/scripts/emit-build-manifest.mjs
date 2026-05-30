#!/usr/bin/env node
// Build-time half of the MCP-04 integrity contract (D-23-11). Reads the
// engine + rules versions that are installed RIGHT NOW (from node_modules)
// and computes the rules content hash via the same primitive
// drift-check.ts uses at runtime. Writes dist/build-manifest.json — the
// source of truth for what was pinned at release. Regenerated on every
// build; NOT committed to git (RESEARCH Open Q3); shipped in the
// published tarball via package.json#files.
//
// Run order: sync-version → sync-wasm → tsc -b → THIS SCRIPT. The tsc -b
// step must run first because this script dynamically imports
// @hookwarden/rules from the workspace, which needs dist/ populated.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, "..");

// The plan called for `require.resolve("@hookwarden/engine/package.json")`,
// but @hookwarden/engine's `exports` map does not whitelist ./package.json
// (ERR_PACKAGE_PATH_NOT_EXPORTED). The ENGINE_VERSION / RULES_PACK_VERSION
// constants are generated from package.json#version by sync-version.mjs
// (Phase 4.2 + Plan 23-01 pattern), so they are byte-equal to package.json's
// version field. Use the constants directly — sidesteps the exports map AND
// avoids a parallel source of truth for "what version did we ship".
const { ENGINE_VERSION } = await import("@hookwarden/engine");
const {
  BUNDLED_RULE_DOCUMENTS,
  PROVIDER_CATALOG,
  RULES_PACK_VERSION,
  computeContentHash,
  validateRuleDocument,
} = await import("@hookwarden/rules");

const engineVersion = ENGINE_VERSION;
const rulesVersion = RULES_PACK_VERSION;
const parsed = BUNDLED_RULE_DOCUMENTS.map((entry) => validateRuleDocument(entry.doc));
const rulesContentHash = await computeContentHash(PROVIDER_CATALOG, parsed);

const manifest = {
  engine: { version: engineVersion, content_hash: null },
  rules: { version: rulesVersion, content_hash: rulesContentHash },
  built_at: new Date().toISOString(),
};

mkdirSync(join(MCP_ROOT, "dist"), { recursive: true });
writeFileSync(
  join(MCP_ROOT, "dist", "build-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
// Silent on success — runs on every build. Failure path uses writeFileSync's
// thrown error (non-zero exit blocks pnpm publish).
