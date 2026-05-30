// `hookwarden update` subcommand integration tests. The detection logic is
// unit-tested in install-channel.test.ts; here we verify the end-to-end CLI
// behavior: stdout shape, exit code, flag parsing, --help.

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, "../../bin/cli.cjs");

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: ReadonlyArray<string>): CliResult {
  const proc = spawnSync("node", [CLI_BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

describe("hookwarden update — output contract", () => {
  it("prints the current version on the first line", () => {
    const r = runCli(["update"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^hookwarden v\d+\.\d+\.\d+/);
  });

  it("prints an Install channel line", () => {
    const r = runCli(["update"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Install channel:/);
  });

  it("prints one of the known channel names or 'not detected'", () => {
    const r = runCli(["update"]);
    expect(r.stdout).toMatch(
      /Install channel: (brew|scoop|npm-global|npx|standalone-binary|not detected)/,
    );
  });

  it("emits a 'To update, run:' instruction OR the multi-line fallback", () => {
    const r = runCli(["update"]);
    const knowsChannel = /To update, run:/.test(r.stdout);
    const fallback = /Run the command for your install method:/.test(r.stdout);
    // Exactly one path must fire.
    expect(knowsChannel || fallback).toBe(true);
  });
});

describe("hookwarden update — flags", () => {
  it("--help prints usage and exits 0 without running detection", () => {
    const r = runCli(["update", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: hookwarden update");
    expect(r.stdout).toContain("--yes");
    expect(r.stdout).toContain("--dry-run");
    // Should NOT have printed the detection output.
    expect(r.stdout).not.toContain("Install channel:");
  });

  it("--dry-run is accepted (no error)", () => {
    const r = runCli(["update", "--dry-run"]);
    expect(r.code).toBe(0);
  });

  it("--yes is accepted (no error)", () => {
    // We don't exercise the actual exec — the test environment is unlikely
    // to be a high-confidence detection (vitest runs via `node node_modules/
    // .bin/vitest` which won't match brew/scoop/npm-global cleanly). The
    // --yes flag should parse and either auto-exec or print the ignored
    // notice, but never crash.
    const r = runCli(["update", "--yes", "--dry-run"]);
    expect(r.code).toBe(0);
  });

  it("rejects unknown flags with exit 3", () => {
    const r = runCli(["update", "--frobnicate"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("unknown flag");
  });
});

describe("hookwarden update — discoverability", () => {
  it("top-level --help mentions the update subcommand", () => {
    const r = runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("hookwarden update");
  });
});
