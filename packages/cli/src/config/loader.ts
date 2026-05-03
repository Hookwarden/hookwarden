// D-75 hookwarden.config.yaml loader: walk-up from cwd, --config <path> override, --no-config bypass.
// T-04-02-01: 1 MiB size cap before parse — yaml-bomb DoS mitigation.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { load as parseYaml } from "js-yaml";
import { type ParsedConfigDocument, validateConfigDocument } from "./schema.js";

export const CONFIG_FILENAME = "hookwarden.config.yaml";

/**
 * Maximum permitted size of a hookwarden.config.yaml file in bytes (T-04-02-01 mitigation).
 * Rejecting files larger than 1 MiB before js-yaml.load() runs prevents pathological
 * documents (huge anchor expansion, deeply nested mappings) from consuming unbounded memory.
 */
const CONFIG_MAX_BYTES = 1024 * 1024; // 1 MiB

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function findConfigFile(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // hit filesystem root
    dir = parent;
  }
}

export async function loadConfigFile(filePath: string): Promise<ParsedConfigDocument> {
  const content = await fs.readFile(filePath, "utf-8");
  // T-04-02-01 — yaml-bomb DoS mitigation. Reject oversized configs BEFORE parse.
  if (content.length > CONFIG_MAX_BYTES) {
    throw new ConfigError(
      `config too large at ${filePath}: ${content.length} bytes (max 1 MiB)`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    throw new ConfigError(`YAML parse error in ${filePath}: ${(err as Error).message}`);
  }
  return validateConfigDocument(parsed);
}

export async function loadConfigFromCwd(opts: {
  readonly cwd: string;
  readonly explicitPath?: string;
  readonly disabled: boolean;
}): Promise<{ readonly path: string | null; readonly config: ParsedConfigDocument | null }> {
  if (opts.disabled) return { path: null, config: null };
  const target = opts.explicitPath
    ? path.resolve(opts.cwd, opts.explicitPath)
    : await findConfigFile(opts.cwd);
  if (target === null) return { path: null, config: null };
  const config = await loadConfigFile(target);
  return { path: target, config };
}
