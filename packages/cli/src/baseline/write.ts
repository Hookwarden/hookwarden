// D-68 baseline write: sorted by primary_location_line_hash for diff stability.
// D-71 footgun warning when --diff-only is active (scope-narrowed baseline never matches a full-repo run).

import { promises as fs } from "node:fs";
import type { Finding, ScanResult } from "@hookwarden/engine";
import type { BaselineDocument, BaselinedFinding } from "./schema.js";

function toBaselinedFinding(f: Finding): BaselinedFinding {
  return {
    primary_location_line_hash: f.primary_location_line_hash,
    rule_id: f.rule_id,
    file_path: f.file_path,
    line: f.location.line,
    severity_at_baseline: f.severity,
    state_at_baseline: f.state,
  };
}

export async function writeBaseline(
  filePath: string,
  result: ScanResult,
  diffOnlyActive: boolean,
): Promise<void> {
  if (diffOnlyActive) {
    process.stderr.write(
      "warning: --baseline write under --diff-only writes a scope-narrowed baseline; the result will not match a full-repo baseline\n",
    );
  }

  const sorted: BaselinedFinding[] = result.findings
    .map(toBaselinedFinding)
    .sort((a, b) => a.primary_location_line_hash.localeCompare(b.primary_location_line_hash));

  const rawHash = result.metadata.rule_pack_content_hash;
  const hash = rawHash.startsWith("sha256:") ? rawHash : `sha256:${rawHash}`;

  const doc: BaselineDocument = {
    schema_version: "1.0",
    baselined_at: new Date().toISOString(),
    engine_version: result.metadata.engine_version,
    rule_pack_version: result.metadata.rule_pack_version,
    rule_pack_content_hash: hash,
    findings: sorted,
  };

  await fs.writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
}
