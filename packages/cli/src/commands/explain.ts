// `hookwarden explain <rule-id>` subcommand — terminal-side rule documentation.
//
// Prints the rule's metadata + full message + relevant provider catalog slice + docs URL
// + a GitHub link to the fixture corpus. Lowers the support burden on the rule-pack
// maintainer; deepens developer trust without leaving the terminal (especially valuable
// on `manual-review` verdicts that a reviewer has to defend in code review).
//
// No fixture content is bundled into the npm dist (see .planning/cli-flag-expansion-v0.5.md
// 'examples' open decision): fixture excerpts would require either a YAML schema extension
// OR a `bundled-fixtures.ts` generated alongside bundled-rules.ts. Both are deferred —
// linking to the GitHub directory is sufficient for v0.4.2.

import { defineCommand } from "citty";
import { loadRulesFromDir } from "../load-rules.js";

export interface ExplainArgs {
  readonly "rule-id"?: string;
  readonly "no-color"?: boolean;
  readonly "rules-dir"?: string;
}

const ANSI = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
} as const;

const GITHUB_FIXTURE_TREE_BASE =
  "https://github.com/Hookwarden/hookwarden/tree/main/packages/rules/test/fixtures";

export async function runExplainCommand(args: ExplainArgs): Promise<number> {
  const ruleId = args["rule-id"]?.trim();
  if (!ruleId || ruleId === "") {
    process.stderr.write(
      "error: usage: hookwarden explain <rule-id>\n" +
        "       e.g. hookwarden explain stripe/timing-unsafe-comparison\n",
    );
    return 3;
  }

  const useAnsi = args["no-color"] !== true && process.stdout.isTTY;
  const ruleSet = await loadRulesFromDir(
    args["rules-dir"] !== undefined ? { rulesDir: args["rules-dir"] } : {},
  );

  const rule = ruleSet.rules.find((r) => r.rule_id === ruleId);
  if (!rule) {
    process.stderr.write(`error: rule '${ruleId}' not found.\n\nAvailable rule IDs:\n`);
    const sortedIds = [...ruleSet.rules.map((r) => r.rule_id)].sort();
    for (const id of sortedIds) process.stderr.write(`  ${id}\n`);
    return 3;
  }

  const catalog = ruleSet.providers[rule.provider];
  const c = (s: string, code: string) => (useAnsi ? `${code}${s}${ANSI.reset}` : s);

  const lines: string[] = [];
  // Header
  lines.push("");
  lines.push(c(rule.rule_id, ANSI.bold + ANSI.cyan));
  lines.push(c("─".repeat(rule.rule_id.length), ANSI.dim));
  lines.push("");

  // Metadata
  lines.push(`${c("provider:    ", ANSI.dim)}${rule.provider}`);
  lines.push(`${c("severity:    ", ANSI.dim)}${rule.severity}`);
  lines.push(`${c("emits state: ", ANSI.dim)}${rule.emits_state}`);
  const appliesTo = rule.applies_to === "all" ? "all 11 frameworks" : rule.applies_to.join(", ");
  lines.push(`${c("applies to:  ", ANSI.dim)}${appliesTo}`);
  if (rule.predicate_name !== null) {
    lines.push(`${c("predicate:   ", ANSI.dim)}${rule.predicate_name}`);
  }
  lines.push("");

  // Why (message body verbatim)
  lines.push(c("Why this rule emits", ANSI.bold));
  lines.push("");
  // Trim trailing newline + indent each line for visual separation
  const message = rule.message.replace(/\n+$/, "");
  for (const ln of message.split("\n")) lines.push(`  ${ln}`);
  lines.push("");

  // Catalog slice
  if (catalog) {
    lines.push(c(`Provider catalog — ${rule.provider}`, ANSI.bold));
    lines.push("");
    lines.push(`  ${c("signature header(s):", ANSI.dim)} ${catalog.signature_header.join(", ")}`);
    lines.push(`  ${c("hmac algorithm:     ", ANSI.dim)} ${catalog.hmac_algorithm}`);
    lines.push(`  ${c("signing input:      ", ANSI.dim)} ${catalog.signing_input_format}`);
    lines.push(`  ${c("signature encoding: ", ANSI.dim)} ${catalog.signature_encoding ?? "n/a"}`);
    if (catalog.timestamp_header !== null && catalog.timestamp_header !== undefined) {
      lines.push(`  ${c("timestamp header:   ", ANSI.dim)} ${catalog.timestamp_header}`);
    }
    if (catalog.sdk_packages.length > 0) {
      lines.push(`  ${c("sdk packages:       ", ANSI.dim)} ${catalog.sdk_packages.join(", ")}`);
    }
    if (catalog.sdk_verify_calls.length > 0) {
      const calls = catalog.sdk_verify_calls.slice(0, 5).join(", ");
      const more =
        catalog.sdk_verify_calls.length > 5
          ? c(` (+${catalog.sdk_verify_calls.length - 5} more)`, ANSI.dim)
          : "";
      lines.push(`  ${c("sdk verify calls:   ", ANSI.dim)} ${calls}${more}`);
    }
    if (catalog.secret_literal_prefix.length > 0) {
      lines.push(
        `  ${c("secret prefix(es):  ", ANSI.dim)} ${catalog.secret_literal_prefix.join(", ")}`,
      );
    }
    lines.push("");
  }

  // Links
  lines.push(c("Learn more", ANSI.bold));
  lines.push("");
  lines.push(`  ${c("provider docs:", ANSI.dim)} ${rule.provider_docs_url}`);
  lines.push(`  ${c("fixtures:     ", ANSI.dim)} ${GITHUB_FIXTURE_TREE_BASE}/${rule.provider}/`);
  lines.push("");

  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export const explainCommand = defineCommand({
  meta: { name: "explain", description: "Print full documentation for a single rule." },
  args: {
    "rule-id": {
      type: "positional",
      required: false,
      description: "Rule ID, e.g. 'stripe/timing-unsafe-comparison'",
    },
    "no-color": { type: "boolean", description: "Disable color and OSC-8 hyperlinks." },
    "rules-dir": {
      type: "string",
      description: "Override the bundled rule pack location (dev-only).",
    },
  },
  run: async ({ args }) => runExplainCommand(args as ExplainArgs),
});
