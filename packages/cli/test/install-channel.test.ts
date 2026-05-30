import { describe, expect, it } from "vitest";

import { allChannelCommands, detectInstallChannel } from "../src/install-channel.js";

describe("detectInstallChannel — happy path per channel", () => {
  it("detects brew on Apple Silicon", () => {
    const info = detectInstallChannel({
      execPath: "/opt/homebrew/Cellar/hookwarden/0.6.0/libexec/hookwarden",
      scriptPath: "/opt/homebrew/Cellar/hookwarden/0.6.0/libexec/bin/cli.cjs",
      platform: "darwin",
    });
    expect(info.channel).toBe("brew");
    expect(info.confidence).toBe("high");
    expect(info.upgradeCommand).toBe("brew upgrade hookwarden");
  });

  it("detects brew on Intel macOS / Linuxbrew", () => {
    const info = detectInstallChannel({
      execPath: "/usr/local/Cellar/hookwarden/0.6.0/libexec/hookwarden",
      scriptPath: "/usr/local/Cellar/hookwarden/0.6.0/libexec/bin/cli.cjs",
      platform: "darwin",
    });
    expect(info.channel).toBe("brew");
    expect(info.confidence).toBe("high");
  });

  it("detects scoop on Windows", () => {
    const info = detectInstallChannel({
      execPath: "C:\\node\\node.exe",
      scriptPath: "C:\\Users\\u\\scoop\\apps\\hookwarden\\current\\bin\\cli.cjs",
      platform: "win32",
    });
    expect(info.channel).toBe("scoop");
    expect(info.confidence).toBe("high");
    expect(info.upgradeCommand).toBe("scoop update hookwarden");
  });

  it("does NOT detect scoop pattern on non-Windows (avoids false positive on path lookalikes)", () => {
    const info = detectInstallChannel({
      execPath: "/usr/local/bin/node",
      scriptPath: "/home/user/scoop/apps/hookwarden/current/bin/cli.cjs",
      platform: "linux",
    });
    // scoop is Windows-only; on linux the pattern shouldn't claim scoop.
    expect(info.channel).not.toBe("scoop");
  });

  it("detects npm global install (canonical lib/node_modules layout)", () => {
    const info = detectInstallChannel({
      execPath: "/usr/local/bin/node",
      scriptPath: "/usr/local/lib/node_modules/hookwarden/bin/cli.cjs",
      platform: "linux",
    });
    expect(info.channel).toBe("npm-global");
    expect(info.confidence).toBe("high");
    expect(info.upgradeCommand).toBe("npm i -g hookwarden@latest");
  });

  it("detects npm global on Apple Silicon (homebrew node prefix)", () => {
    const info = detectInstallChannel({
      execPath: "/opt/homebrew/bin/node",
      scriptPath: "/opt/homebrew/lib/node_modules/hookwarden/bin/cli.cjs",
      platform: "darwin",
    });
    expect(info.channel).toBe("npm-global");
    expect(info.confidence).toBe("high");
  });

  it("detects npx (cache path)", () => {
    const info = detectInstallChannel({
      execPath: "/usr/local/bin/node",
      scriptPath: "/Users/u/.npm/_npx/abc123/node_modules/hookwarden/bin/cli.cjs",
      platform: "darwin",
    });
    expect(info.channel).toBe("npx");
    expect(info.confidence).toBe("high");
  });

  it("npx pattern wins over the generic node_modules pattern", () => {
    // Both _npx/ AND node_modules/hookwarden/ are in the path. We want npx,
    // not npm-global, since the user is running via `npx hookwarden`.
    const info = detectInstallChannel({
      execPath: "/usr/local/bin/node",
      scriptPath: "/home/u/.npm/_npx/cache-key/node_modules/hookwarden/dist/index.js",
      platform: "linux",
    });
    expect(info.channel).toBe("npx");
  });

  it("detects standalone binary (bun --compile output, hookwarden as execPath basename)", () => {
    const info = detectInstallChannel({
      execPath: "/usr/local/bin/hookwarden",
      scriptPath: "/usr/local/bin/hookwarden",
      platform: "linux",
    });
    expect(info.channel).toBe("standalone-binary");
    expect(info.confidence).toBe("medium");
    expect(info.upgradeCommand).toContain("re-download");
  });

  it("detects standalone binary on Windows (.exe suffix)", () => {
    const info = detectInstallChannel({
      execPath: "C:\\Program Files\\hookwarden\\hookwarden.exe",
      scriptPath: "C:\\Program Files\\hookwarden\\hookwarden.exe",
      platform: "win32",
    });
    expect(info.channel).toBe("standalone-binary");
  });
});

describe("detectInstallChannel — fallbacks and edge cases", () => {
  it("returns 'unknown' when no pattern matches and execPath is node (not hookwarden)", () => {
    const info = detectInstallChannel({
      execPath: "/usr/bin/node",
      scriptPath: "/some/random/path/that/does/not/match/hookwarden.js",
      platform: "linux",
    });
    expect(info.channel).toBe("unknown");
    expect(info.confidence).toBe("low");
  });

  it("returns medium-confidence npm-global on bare node_modules/hookwarden pattern (local install)", () => {
    // No lib/ prefix → could be a project-local install. Still useful to
    // suggest `npm i -g hookwarden@latest`, but mark medium confidence so
    // --yes does NOT auto-exec.
    const info = detectInstallChannel({
      execPath: "/usr/bin/node",
      scriptPath: "/home/u/repo/node_modules/hookwarden/dist/index.js",
      platform: "linux",
    });
    expect(info.channel).toBe("npm-global");
    expect(info.confidence).toBe("medium");
  });

  it("brew pattern is case-sensitive (Cellar, not cellar)", () => {
    const info = detectInstallChannel({
      execPath: "/some/cellar/hookwarden/0.6.0/bin/hookwarden",
      scriptPath: "/some/cellar/hookwarden/0.6.0/bin/cli.cjs",
      platform: "darwin",
    });
    // Lowercase "cellar" must NOT match Cellar; falls through to standalone
    // (execPath basename is hookwarden).
    expect(info.channel).toBe("standalone-binary");
  });
});

describe("allChannelCommands — for unknown-channel fallback rendering", () => {
  it("lists every channel's upgrade command in a stable order", () => {
    const cmds = allChannelCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(5);
    expect(cmds).toContain("brew upgrade hookwarden");
    expect(cmds).toContain("scoop update hookwarden");
    expect(cmds).toContain("npm i -g hookwarden@latest");
    expect(cmds).toContain("pip install -U hookwarden");
    expect(cmds).toContain("npx hookwarden@latest scan .");
  });
});
