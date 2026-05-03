import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILENAME,
  ConfigError,
  findConfigFile,
  loadConfigFile,
  loadConfigFromCwd,
} from "../src/config/loader.js";

const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hookwarden-cfg-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("findConfigFile", () => {
  it("returns the absolute path when a config sits in the start dir", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, 'schema_version: "1.0"\n');
    expect(await findConfigFile(dir)).toBe(cfg);
  });

  it("walks up to find a config in an ancestor directory", async () => {
    const root = await makeTempDir();
    const nested = path.join(root, "a", "b", "c");
    await fs.mkdir(nested, { recursive: true });
    const cfg = path.join(root, CONFIG_FILENAME);
    await fs.writeFile(cfg, 'schema_version: "1.0"\n');
    expect(await findConfigFile(nested)).toBe(cfg);
  });

  it("returns null when no config is found anywhere on the path", async () => {
    const dir = await makeTempDir();
    const nested = path.join(dir, "a", "b");
    await fs.mkdir(nested, { recursive: true });
    expect(await findConfigFile(nested)).toBeNull();
  });
});

describe("loadConfigFile", () => {
  it("returns a ParsedConfigDocument for a valid YAML file", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, 'schema_version: "1.0"\nfail_on: high\n');
    const doc = await loadConfigFile(cfg);
    expect(doc.schema_version).toBe("1.0");
    expect(doc.fail_on).toBe("high");
  });

  it("throws with the offending key when a YAML file has an unknown top-level key", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, 'schema_version: "1.0"\nbananas: 3\n');
    await expect(loadConfigFile(cfg)).rejects.toThrow(/bananas/);
  });

  it("throws a YAML-tagged error on malformed YAML", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, "schema_version: '1.0\n  : : :");
    await expect(loadConfigFile(cfg)).rejects.toThrow(/YAML/);
  });

  it("propagates ENOENT for files that do not exist", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, "does-not-exist.yaml");
    await expect(loadConfigFile(cfg)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects config larger than 1 MiB before parse (T-04-02-01)", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    const padding = `# ${"x".repeat(1024 * 1024 - 2)}`;
    const content = `schema_version: "1.0"\n${padding}\n`;
    await fs.writeFile(cfg, content);
    await expect(loadConfigFile(cfg)).rejects.toThrow(/1 MiB/);
  });

  it("ConfigError is the named throw class", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, "schema_version: '1.0\n  : : :");
    await expect(loadConfigFile(cfg)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("loadConfigFromCwd", () => {
  it("returns null path + null config when disabled", async () => {
    const dir = await makeTempDir();
    const result = await loadConfigFromCwd({ cwd: dir, disabled: true });
    expect(result).toEqual({ path: null, config: null });
  });

  it("uses explicit path when provided", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, "custom.yaml");
    await fs.writeFile(cfg, 'schema_version: "1.0"\nfail_on: low\n');
    const result = await loadConfigFromCwd({
      cwd: dir,
      explicitPath: "custom.yaml",
      disabled: false,
    });
    expect(result.path).toBe(cfg);
    expect(result.config?.fail_on).toBe("low");
  });

  it("walks up when no explicit path is given", async () => {
    const dir = await makeTempDir();
    const cfg = path.join(dir, CONFIG_FILENAME);
    await fs.writeFile(cfg, 'schema_version: "1.0"\n');
    const nested = path.join(dir, "x", "y");
    await fs.mkdir(nested, { recursive: true });
    const result = await loadConfigFromCwd({ cwd: nested, disabled: false });
    expect(result.path).toBe(cfg);
  });
});
