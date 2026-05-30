// hookwarden CLI entry. D-45 citty defineCommand. D-46 sibling scan + inventory.
// D-47 no-arg help. D-48 zero-config flags. D-49 exit 0/1/2/3/4 (Phase 4 expanded matrix).

import { defineCommand } from "citty";
import { renderBanner, shouldShowBanner } from "./banner.js";
import { explainCommand, runExplainCommand } from "./commands/explain.js";
import { type FixArgs, fixCommand, runFixCommand } from "./commands/fix.js";
import { type InventoryArgs, inventoryCommand, runInventoryCommand } from "./commands/inventory.js";
import { runScanCommand, type ScanArgs, scanCommand } from "./commands/scan.js";
import { runUpdateCommand, type UpdateArgs } from "./commands/update.js";
import { renderLogo } from "./logo.js";
// VERSION is generated from package.json by scripts/sync-version.mjs (runs in
// `prepare` + `prepack` + CI before `bun build --compile`). Generating a TS
// constant bakes the literal into both the npm-published dist/ AND the Bun
// compiled binary, side-stepping the runtime read-package.json failure inside
// Bun's virtual /$bunfs/ filesystem. D-05 lockstep with Changesets is preserved
// because the Changesets release bumps package.json#version, sync-version
// regenerates src/version.ts before publish/compile, and any drift is a
// build-time error rather than a runtime surprise.
import { VERSION } from "./version.js";
import { shouldUseAnsi } from "./walker/tty.js";

// Public registration of the citty command tree (consumed by hosts that prefer citty's runMain).
export const root = defineCommand({
  meta: {
    name: "hookwarden",
    version: VERSION,
    description:
      "Webhook security audit CLI. Find signature-verification bugs in JS/TS, Python, and PHP.",
  },
  subCommands: {
    scan: scanCommand,
    inventory: inventoryCommand,
    explain: explainCommand,
    fix: fixCommand,
  },
});

const HELP_TEXT =
  `hookwarden v${VERSION} — webhook security audit CLI\n` +
  `Scans JS/TS, Python, and PHP webhook handlers for signature-verification bugs.\n\n` +
  `Usage:\n` +
  `  hookwarden scan [path]       Scan a project for verification bugs.\n` +
  `  hookwarden inventory [path]  List every detected webhook handler.\n` +
  `  hookwarden explain <rule>    Print full documentation for a single rule.\n` +
  `  hookwarden fix [path]        Apply mechanical fixes for safety:safe findings (dry-run by default).\n` +
  `  hookwarden update            Print the upgrade command for your install channel (use --yes to run it).\n` +
  `  hookwarden logo              Print the hookwarden mascot + wordmark.\n\n` +
  `Common flags:\n` +
  `  -v, --verbose                Verbose output (scan only).\n` +
  `      --no-color               Disable color and OSC-8 hyperlinks.\n` +
  `      --color WHEN             always | never | auto (default). 'always' forces color through a pipe.\n` +
  `      --rules-dir D            Override the bundled rule pack (dev-only).\n` +
  `      --help, -h               Show subcommand help.\n` +
  `      --version, -V            Print CLI version.\n\n` +
  `Scan-only flags (Phase 4):\n` +
  `      --format F               Output format: text | json | sarif.\n` +
  `      --fail-on S              Severity threshold: critical | high | medium | low.\n` +
  `      --baseline write         Capture current findings as a baseline (auto-read otherwise).\n` +
  `      --no-baseline            Disable baseline reading.\n` +
  `      --diff-only              Scan only files changed vs base ref.\n` +
  `      --diff-base R            Override auto-detected base ref.\n` +
  `      --config P               Path to hookwarden.config.yaml.\n` +
  `      --no-config              Bypass config-file discovery.\n` +
  `      --strict-suppressions    Promote stale suppressions to errors.\n` +
  `      --min-parse-coverage N   Minimum parse-coverage ratio 0..1 (default 0.95).\n` +
  `      --include-tests          Scan test/fixture/mock paths too (excluded by default).\n\n` +
  `Fix-only flags (Phase 8.2):\n` +
  `      --write                  Write fixes to disk via atomic staging. Default: dry-run.\n` +
  `      --mode M                 safe | all | manual-only-explain (default: safe).\n` +
  `      --only IDS               Comma-separated rule IDs to filter.\n` +
  `      --accept-unsafe          Required for --mode all in non-TTY (D-12).\n`;

interface ParsedFlags {
  path?: string;
  verbose?: boolean;
  "no-color"?: boolean;
  color?: string;
  "rules-dir"?: string;
  // Phase 4:
  format?: string;
  "fail-on"?: string;
  baseline?: string;
  "no-baseline"?: boolean;
  "diff-only"?: boolean;
  "diff-base"?: string;
  config?: string;
  "no-config"?: boolean;
  "strict-suppressions"?: boolean;
  "min-parse-coverage"?: string;
  "include-tests"?: boolean;
  provider?: string;
  exclude?: string;
  include?: string;
  help?: boolean;
  // Phase 8.2 — `hookwarden fix`
  write?: boolean;
  mode?: string;
  only?: string;
  "accept-unsafe"?: boolean;
  // `hookwarden update`
  yes?: boolean;
  "dry-run"?: boolean;
}

interface ParseResult {
  readonly flags: ParsedFlags;
  readonly error: string | null;
}

const STRING_FLAGS: ReadonlyArray<{
  readonly long: string;
  readonly key: string;
}> = [
  { long: "--rules-dir", key: "rules-dir" },
  { long: "--color", key: "color" },
  { long: "--format", key: "format" },
  { long: "--fail-on", key: "fail-on" },
  { long: "--baseline", key: "baseline" },
  { long: "--diff-base", key: "diff-base" },
  { long: "--config", key: "config" },
  { long: "--min-parse-coverage", key: "min-parse-coverage" },
  { long: "--provider", key: "provider" },
  { long: "--exclude", key: "exclude" },
  { long: "--include", key: "include" },
  // Phase 8.2 — `hookwarden fix` flags.
  { long: "--mode", key: "mode" },
  { long: "--only", key: "only" },
];

const BOOLEAN_FLAGS: ReadonlyArray<{
  readonly long: string;
  readonly key: string;
}> = [
  { long: "--no-color", key: "no-color" },
  { long: "--no-baseline", key: "no-baseline" },
  { long: "--diff-only", key: "diff-only" },
  { long: "--no-config", key: "no-config" },
  { long: "--strict-suppressions", key: "strict-suppressions" },
  { long: "--include-tests", key: "include-tests" },
  // Phase 8.2 — `hookwarden fix` flags.
  { long: "--write", key: "write" },
  { long: "--accept-unsafe", key: "accept-unsafe" },
  // `hookwarden update` flags.
  { long: "--yes", key: "yes" },
  { long: "--dry-run", key: "dry-run" },
];

function parseFlags(argv: ReadonlyArray<string>): ParseResult {
  const out: ParsedFlags = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i++;
      continue;
    }
    if (arg === "-v" || arg === "--verbose") {
      out.verbose = true;
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      i++;
      continue;
    }
    let matched = false;
    for (const f of BOOLEAN_FLAGS) {
      if (arg === f.long) {
        (out as Record<string, unknown>)[f.key] = true;
        i++;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    for (const f of STRING_FLAGS) {
      if (arg === f.long) {
        const next = argv[i + 1];
        if (next === undefined) {
          return { flags: out, error: `flag ${f.long} requires a value` };
        }
        (out as Record<string, unknown>)[f.key] = next;
        i += 2;
        matched = true;
        break;
      }
      // Support --flag=value form.
      if (arg.startsWith(`${f.long}=`)) {
        (out as Record<string, unknown>)[f.key] = arg.slice(f.long.length + 1);
        i++;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (!arg.startsWith("-") && out.path === undefined) {
      out.path = arg;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      // D-65 — unknown flag is a config error (exit 3).
      return { flags: out, error: `unknown flag '${arg}'` };
    }
    i++;
  }
  return { flags: out, error: null };
}

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  // No args → branded landing on TTY, plain help otherwise (D-47).
  if (argv.length === 0) {
    const showBanner = shouldShowBanner({
      stream: process.stdout,
      env: process.env,
      noColorFlag: false,
    });
    if (showBanner) {
      process.stdout.write(renderBanner({ version: VERSION, useAnsi: true }));
      return 0;
    }
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  // Top-level --version / -V → print and exit 0.
  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Top-level --help / -h → print help and exit 0.
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const sub = argv[0];
  try {
    if (sub === "scan") {
      const { flags, error } = parseFlags(argv.slice(1));
      if (error !== null) {
        process.stderr.write(`error: ${error}\n`);
        return 3;
      }
      if (flags.help === true) {
        process.stdout.write(`Usage: hookwarden scan [path] [flags]\n`);
        return 0;
      }
      return await runScanCommand(flags as ScanArgs);
    }
    if (sub === "inventory") {
      const { flags, error } = parseFlags(argv.slice(1));
      if (error !== null) {
        process.stderr.write(`error: ${error}\n`);
        return 3;
      }
      if (flags.help === true) {
        process.stdout.write(`Usage: hookwarden inventory [path] [flags]\n`);
        return 0;
      }
      return await runInventoryCommand(flags as InventoryArgs);
    }
    if (sub === "explain") {
      // explain takes a positional rule-id; reuse the custom parser for --no-color / --rules-dir,
      // then extract the first non-flag positional from the original argv tail.
      const tail = argv.slice(1);
      const positional = tail.find((t) => !t.startsWith("--"));
      const { flags, error } = parseFlags(tail);
      if (error !== null) {
        process.stderr.write(`error: ${error}\n`);
        return 3;
      }
      if (flags.help === true) {
        process.stdout.write(`Usage: hookwarden explain <rule-id> [--no-color] [--rules-dir D]\n`);
        return 0;
      }
      return await runExplainCommand({
        ...(positional !== undefined ? { "rule-id": positional } : {}),
        ...(flags["no-color"] !== undefined ? { "no-color": flags["no-color"] } : {}),
        ...(flags["rules-dir"] !== undefined ? { "rules-dir": flags["rules-dir"] } : {}),
      });
    }
    if (sub === "fix") {
      const { flags, error } = parseFlags(argv.slice(1));
      if (error !== null) {
        process.stderr.write(`error: ${error}\n`);
        return 3;
      }
      if (flags.help === true) {
        process.stdout.write(
          `Usage: hookwarden fix [path] [--write] [--mode M] [--only IDS] [--format F] [--accept-unsafe]\n`,
        );
        return 0;
      }
      return await runFixCommand(flags as FixArgs);
    }
    if (sub === "update") {
      const { flags, error } = parseFlags(argv.slice(1));
      if (error !== null) {
        process.stderr.write(`error: ${error}\n`);
        return 3;
      }
      if (flags.help === true) {
        process.stdout.write(
          `Usage: hookwarden update [--yes] [--dry-run] [--no-color]\n\n` +
            `Detects how hookwarden was installed (brew, scoop, npm-global, npx,\n` +
            `standalone binary) and prints the upgrade command for that channel.\n\n` +
            `  --yes       Run the upgrade command (only on high-confidence detections).\n` +
            `  --dry-run   Force print-only even with --yes.\n`,
        );
        return 0;
      }
      return await runUpdateCommand(flags as UpdateArgs);
    }
    if (sub === "logo") {
      const noColor = argv.includes("--no-color");
      const useAnsi = !noColor && shouldUseAnsi(process.stdout, process.env);
      const columns = process.stdout.columns ?? 80;
      process.stdout.write(`${renderLogo({ columns, useAnsi })}\n`);
      return 0;
    }
    process.stderr.write(`error: unknown command '${sub}'\nrun 'hookwarden' for help\n`);
    return 2;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    return 2;
  }
}

// Self-invoke when this file IS the binary entry (Bun --compile output).
// Under Node + npm, packages/cli/bin/cli.cjs is the entry and explicitly
// calls main() — `import.meta.main` is undefined in Node, so this guard
// stays inert. Under Bun's `--compile`, the bundled module IS the entry,
// `import.meta.main` is `true`, and we boot the CLI here.
//
// Library consumers (`import { main } from "hookwarden"`) also stay inert
// because import.meta.main is only true for the literal process entry.
//
// Exit semantics for the compiled binary: Bun's --target=bun-linux-* compiled
// output does NOT reliably honor `process.exitCode` at end-of-event-loop
// (verified against bun 1.3.14 in CI Ubuntu 24.04 arm64/x64 on 2026-05-18:
// scan exited 0 despite setting exitCode = 1, then dumped Bun's internal
// string table to stdout). Native macOS arm64 compilation honored it
// correctly; only cross-compiled Linux targets exhibit the bug. The fix
// is to drain stdout explicitly via a flushed write callback, then call
// `process.exit(code)` — this avoids the SARIF-on-pipe truncation that
// motivated process.exitCode in the first place, while guaranteeing the
// process exits with the right status on every target.
const isCompiledEntry = (import.meta as ImportMeta & { main?: boolean }).main === true;
if (isCompiledEntry) {
  const code = await main(process.argv.slice(2));
  await new Promise<void>((resolve) => {
    process.stdout.write("", () => resolve());
  });
  process.exit(code);
}
