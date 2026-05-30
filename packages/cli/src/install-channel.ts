// Best-effort detection of the install channel hookwarden was launched from.
// Used by `hookwarden update` to print (or run) the channel-appropriate
// upgrade command. Detection is pure and side-effect-free — the runtime
// only feeds in `process.execPath`, the script path, and `process.platform`.
//
// Confidence levels:
//   high   — path pattern is channel-distinctive (e.g. /Cellar/hookwarden/ → brew).
//   medium — pattern matches a generic shape (e.g. /lib/node_modules/hookwarden/).
//   low    — couldn't match a known channel; channel is "unknown".
//
// --yes auto-exec only runs on high-confidence detections. Anything lower
// just prints the suggested command and lets the user run it.

export type InstallChannel =
  | "brew"
  | "scoop"
  | "npm-global"
  | "npx"
  | "standalone-binary"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface ChannelInfo {
  readonly channel: InstallChannel;
  readonly upgradeCommand: string;
  readonly confidence: Confidence;
}

export interface DetectInput {
  readonly execPath: string;
  readonly scriptPath: string;
  readonly platform: NodeJS.Platform;
}

const UPGRADE_COMMANDS: Record<Exclude<InstallChannel, "unknown">, string> = {
  brew: "brew upgrade hookwarden",
  scoop: "scoop update hookwarden",
  "npm-global": "npm i -g hookwarden@latest",
  npx: "npx hookwarden@latest scan .",
  "standalone-binary": "re-download from https://github.com/Hookwarden/hookwarden/releases/latest",
};

const ALL_CHANNEL_COMMANDS: ReadonlyArray<string> = [
  "brew upgrade hookwarden",
  "scoop update hookwarden",
  "npm i -g hookwarden@latest",
  "pip install -U hookwarden",
  "npx hookwarden@latest scan .",
];

// Path matching uses forward slashes; normalize Windows backslashes first.
function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

export function detectInstallChannel(input: DetectInput): ChannelInfo {
  const exec = normalize(input.execPath);
  const script = normalize(input.scriptPath);
  const combined = `${exec}\n${script}`;

  // brew — Cellar layout is distinctive on both Apple Silicon (/opt/homebrew)
  // and Intel/Linuxbrew (/usr/local, /home/linuxbrew).
  if (/\/Cellar\/hookwarden\//.test(combined)) {
    return { channel: "brew", upgradeCommand: UPGRADE_COMMANDS.brew, confidence: "high" };
  }

  // scoop (Windows only) — apps/hookwarden under user or global scoop root.
  if (input.platform === "win32" && /\/scoop\/apps\/hookwarden\//i.test(combined)) {
    return { channel: "scoop", upgradeCommand: UPGRADE_COMMANDS.scoop, confidence: "high" };
  }

  // npx — npm's cache writes to ~/.npm/_npx/ on every machine that's run npx.
  if (/\/_npx\//.test(combined)) {
    return { channel: "npx", upgradeCommand: UPGRADE_COMMANDS.npx, confidence: "high" };
  }

  // npm global — the canonical layout is .../lib/node_modules/hookwarden/.
  // High-confidence requires the full prefix; a bare "node_modules/hookwarden"
  // could be a local-install too, so that case gets medium confidence.
  if (/\/lib\/node_modules\/hookwarden\//.test(combined)) {
    return {
      channel: "npm-global",
      upgradeCommand: UPGRADE_COMMANDS["npm-global"],
      confidence: "high",
    };
  }
  if (/\/node_modules\/hookwarden\//.test(combined)) {
    return {
      channel: "npm-global",
      upgradeCommand: UPGRADE_COMMANDS["npm-global"],
      confidence: "medium",
    };
  }

  // standalone binary — the bun-compiled binary has execPath ending in
  // "hookwarden" (no node), AND none of the above patterns match. Pip-
  // installed hookwarden also lands here (PyPI ships a binary wrapper).
  const execBasename = exec.split("/").pop() ?? "";
  if (/^hookwarden(\.exe)?$/i.test(execBasename)) {
    return {
      channel: "standalone-binary",
      upgradeCommand: UPGRADE_COMMANDS["standalone-binary"],
      confidence: "medium",
    };
  }

  return {
    channel: "unknown",
    upgradeCommand: ALL_CHANNEL_COMMANDS.join("\n  "),
    confidence: "low",
  };
}

export function allChannelCommands(): ReadonlyArray<string> {
  return ALL_CHANNEL_COMMANDS;
}
