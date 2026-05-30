// `hookwarden update` — print (or with --yes, run) the channel-appropriate
// upgrade command for the currently-installed hookwarden.
//
// Output shape: one verdict line, one detected-channel line, one suggested
// command (or the full list when the channel is unknown). With --yes and a
// high-confidence detection, the command is exec'd in-process.
//
// Auto-exec is gated on confidence: medium / low / unknown always print
// and exit 0. This avoids `npm i -g` running without permission on an
// ambiguous Linux box, and avoids shelling out to a wrong command.

import { allChannelCommands, detectInstallChannel } from "../install-channel.js";
import { VERSION } from "../version.js";

export interface UpdateArgs {
  readonly yes?: boolean;
  readonly "dry-run"?: boolean;
  readonly "no-color"?: boolean;
}

export async function runUpdateCommand(args: UpdateArgs): Promise<number> {
  const info = detectInstallChannel({
    execPath: process.execPath,
    scriptPath: process.argv[1] ?? "",
    platform: process.platform,
  });

  const stdout = process.stdout;
  stdout.write(`hookwarden v${VERSION}\n`);

  if (info.channel === "unknown") {
    stdout.write(`Install channel: not detected.\n\n`);
    stdout.write(`Run the command for your install method:\n`);
    for (const cmd of allChannelCommands()) {
      stdout.write(`  ${cmd}\n`);
    }
    return 0;
  }

  const confidenceHint = info.confidence === "high" ? "" : ` (best guess)`;
  stdout.write(`Install channel: ${info.channel}${confidenceHint}\n\n`);
  stdout.write(`To update, run:\n  ${info.upgradeCommand}\n`);

  const dryRun = args["dry-run"] === true;
  const autoExec = args.yes === true && !dryRun && info.confidence === "high";

  // standalone-binary and npx don't have an in-process upgrade command we'd
  // want to run for the user. Binary: re-download is a manual step. npx: the
  // suggested invocation IS scan, not an install — running it here would
  // launch a scan in the current dir, surprising and wrong.
  const canAutoExec = autoExec && info.channel !== "standalone-binary" && info.channel !== "npx";

  if (canAutoExec) {
    stdout.write(`\nExecuting...\n`);
    const { execSync } = await import("node:child_process");
    try {
      execSync(info.upgradeCommand, { stdio: "inherit" });
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: upgrade command failed: ${message}\n`);
      return 1;
    }
  }

  if (args.yes === true && !canAutoExec) {
    stdout.write(`\n(--yes ignored: ${info.channel} requires manual action)\n`);
  }

  return 0;
}
