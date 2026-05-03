import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultRulesDir } from "../src/load-rules.js";
import { runScan } from "../src/pipeline.js";

let tmp: string;

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cli-cmd-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runScan pipeline (CLI-01 + DISCOVERY-01)", () => {
  it("returns ScanResult with metadata, even on empty dir", async () => {
    const out = await runScan({ rootPath: tmp });
    expect(out.result.findings).toEqual([]);
    expect(out.result.inventory).toEqual([]);
    expect(out.result.metadata.engine_version).toBeTruthy();
    expect(out.result.metadata.rule_pack_version).toBeTruthy();
    expect(out.durationMs).toBeGreaterThan(0);
    expect(out.walkResult.parsed_files_count_estimate).toBe(0);
  });

  it("respects .gitignore — excluded files do not appear in walkResult", async () => {
    await writeFile(".gitignore", "private/\n");
    await writeFile("public.ts", "// keep");
    await writeFile("private/secret.ts", "const whsec_test_DEMO = 'whsec_x';");
    const out = await runScan({ rootPath: tmp });
    const rels = out.walkResult.files.map((f) => path.relative(tmp, f));
    expect(rels).toContain("public.ts");
    expect(rels.some((p) => p.startsWith("private"))).toBe(false);
  });

  it("propagates rules-load failure when rulesDir does not contain YAMLs", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "no-rules-"));
    try {
      await expect(runScan({ rootPath: tmp, rulesDir: empty })).rejects.toThrow(/rule pack/i);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("resolveDefaultRulesDir (W-6 flat-install regression)", () => {
  it("resolves to a path whose final segment is 'rules'", () => {
    const dir = resolveDefaultRulesDir();
    expect(path.basename(dir)).toBe("rules");
    // In a workspace layout, the resolved path is `<repo>/packages/rules/rules`.
    // In a flat-install layout, it's `<consumer>/node_modules/@hookwarden/rules/rules`.
    // Either form satisfies the W-6 mitigation: the resolver does not assume a
    // relative `..` walk from the CLI's installed location.
    const isWorkspace = dir.includes(`packages${path.sep}rules${path.sep}rules`);
    const isFlatInstall = dir.includes(`@hookwarden${path.sep}rules${path.sep}rules`);
    expect(isWorkspace || isFlatInstall).toBe(true);
  });
});
