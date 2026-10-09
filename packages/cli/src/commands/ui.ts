// `hookwarden ui [path]` — local web UI over the same scan + fix code paths.
// The server (and all its request guards) lives in @hookwarden/ui; this file
// only wires the CLI's scan and fix logic in as handlers.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import * as path from "node:path";
import { type FixPreviewEdit, startUiServer, type UiHandlers } from "@hookwarden/ui";
import { ConfigError, loadConfigFromCwd } from "../config/loader.js";
import { resolveConfig } from "../config/precedence.js";
import { runScan } from "../pipeline.js";
import { renderJson } from "../render/index.js";
import { planFixes, writeFixes } from "./fix.js";

export interface UiArgs {
  readonly path?: string;
  readonly port?: string;
  readonly "no-open"?: boolean;
  readonly "rules-dir"?: string;
}

export async function runUiCommand(args: UiArgs): Promise<number> {
  const root = path.resolve(args.path ?? ".");
  try {
    if (!statSync(root).isDirectory()) {
      process.stderr.write(`error: ${root} is not a directory\n`);
      return 3;
    }
  } catch {
    process.stderr.write(`error: ${root} does not exist\n`);
    return 3;
  }
  const port = args.port === undefined ? 0 : Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`error: --port must be an integer 0-65535 (got "${args.port}")\n`);
    return 3;
  }

  const server = await startUiServer({
    root,
    port,
    handlers: buildHandlers(root, args["rules-dir"]),
  });
  process.stdout.write(
    `hookwarden ui — ${root}\n\n  ${server.url}\n\nOnly reachable from this machine. Press Ctrl+C to stop.\n`,
  );
  if (args["no-open"] !== true) openBrowser(server.url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

export function buildHandlers(root: string, rulesDir: string | undefined): UiHandlers {
  async function scan(): Promise<object> {
    let resolvedConfig: ReturnType<typeof resolveConfig>;
    try {
      const configResult = await loadConfigFromCwd({ cwd: root, disabled: false });
      resolvedConfig = resolveConfig(
        rulesDir !== undefined ? { rules_dir: rulesDir } : {},
        process.env,
        configResult.config,
      );
    } catch (e) {
      if (e instanceof ConfigError) throw new Error(`config: ${e.message}`);
      throw e;
    }
    const out = await runScan({
      rootPath: root,
      resolvedConfig,
      diffOnly: false,
      diffBase: null,
      baselineWrite: false,
      verbose: false,
    });
    if (out.engineError !== null) throw out.engineError;
    return JSON.parse(
      renderJson({ scanResult: out.result, ruleSet: out.ruleSet, stale: out.stale }),
    ) as object;
  }

  return {
    scan,
    async previewFix({ ruleId, file }) {
      // Dry-run in "all" mode so unsafe/manual edits are shown too; they are never written.
      const plan = await planFixes({
        path: root,
        rulesDir,
        options: {
          mode: "all",
          write: false,
          isTty: false,
          acceptUnsafe: true,
          only: [ruleId],
          format: "json",
        },
      });
      if ("error" in plan) throw new Error(plan.error);
      return plan.result.fixes
        .filter((f) => f.filePath === file)
        .map(
          (f): FixPreviewEdit => ({
            file: f.filePath,
            start: f.start,
            end: f.end,
            before: f.before,
            after: f.after,
            safety: f.safety,
          }),
        );
    },
    async applyFix({ ruleId, file }) {
      // Only safe edits are ever written from the UI.
      const plan = await planFixes({
        path: root,
        rulesDir,
        options: { mode: "safe", write: true, isTty: false, only: [ruleId], format: "json" },
      });
      if ("error" in plan) throw new Error(plan.error);
      if (plan.result.suggestion !== null) throw new Error(plan.result.suggestion.trim());
      const edits = plan.result.fixes.filter((f) => f.filePath === file && f.safety === "safe");
      if (edits.length > 0) await writeFixes(plan.cwd, edits);
      return { applied: edits.length, scan: await scan() };
    },
  };
}

function openBrowser(url: string): void {
  const [cmd, argv] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, argv, { stdio: "ignore", detached: true });
    child.on("error", () => undefined); // no browser available: the URL is already printed
    child.unref();
  } catch {
    // Same: fall back to the printed URL.
  }
}
