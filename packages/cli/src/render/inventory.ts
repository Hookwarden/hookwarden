// DISCOVERY-01: tabular `hookwarden inventory` output — framework | route_pattern | provider | state | file:line.
// Pure: returns a single string. CLI shell (Plan 07) is the only place that writes to stdout.
//
// D-42 state badge gates color on useAnsi. D-43 OSC-8 hyperlinks degrade to plain file:line text.
//
// v0.7.6 webhook-evidence filter (default-on): the engine adapters produce a
// "candidate" for every body-mutating route export (Express app.post, Next.js
// `export function POST`, etc.). Those candidates include legitimate
// non-webhook endpoints (auth/signup, cron jobs, generic API routes) that
// happen to share the same surface shape as a webhook receiver. Showing all
// of them in `hookwarden inventory` dissolved the provider-anchored
// wedge-vs-grep promise — cal.com produced 25 "webhook handlers" of which
// ~22 were just POST routes. The renderer now suppresses zero-evidence
// candidates by default and only shows handlers with at least one webhook
// signal (signature_header_read / sdk_import / secret_env_var_reference /
// secret_literal_match / path_pattern_match / body_as_bytes_or_buffer).
// `--all` opts back into the historical behavior for users who need the
// full candidate list (e.g. auditing what the engine considered).

import * as path from "node:path";
import type { ScanResult, WebhookHandler } from "@hookwarden/engine";
import { ansiLink, dim, stateBadge } from "./colors.js";

export interface RenderInventoryOptions {
  readonly useAnsi: boolean;
  readonly cwd: string;
  /**
   * When true, bypass the evidence filter and show every adapter-detected
   * candidate (including 0-evidence routes that look webhook-shaped but
   * carry no provider signals). Default false — narrower, less noise.
   */
  readonly all?: boolean;
  /**
   * When true, append an `evidence` column to the table with the per-handler
   * signal count. Helps explain why a handler made it through (or didn't).
   */
  readonly verbose?: boolean;
}

const EMPTY_MESSAGE =
  "No webhook handlers detected. Frameworks supported: Express, Hono, Fastify, Next.js, Flask, FastAPI, Django.\n";

interface Row {
  readonly framework: string;
  readonly route: string;
  readonly provider: string;
  readonly state: string;
  readonly stateRaw: string;
  readonly fileLink: string;
  readonly fileRaw: string;
  readonly evidence: number;
}

function buildRow(h: WebhookHandler, opts: RenderInventoryOptions): Row {
  const fwLabel =
    h.framework_version !== null ? `${h.framework}@${h.framework_version}` : h.framework;
  const fileText = `${h.file_path}:${h.location.line}`;
  const abs = path.resolve(opts.cwd, h.file_path);
  const fileLink = ansiLink(`file://${abs}:${h.location.line}:${h.location.col}`, fileText, opts);
  const stateText = `[${h.verification_state}]`;
  return {
    framework: fwLabel,
    route: h.route_pattern,
    provider: h.provider,
    state: stateBadge(h.verification_state, opts),
    stateRaw: stateText,
    fileLink,
    fileRaw: fileText,
    evidence: h.evidence.length,
  };
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

const BOLD_ON = "\x1b[1m";
const BOLD_OFF = "\x1b[0m";

export function renderInventory(result: ScanResult, opts: RenderInventoryOptions): string {
  const showAll = opts.all === true;
  const showEvidence = opts.verbose === true;

  // Filter to webhook-evidenced handlers by default. The engine emits one
  // CandidateHandler per body-mutating route export; only those with at
  // least one webhook signal in `evidence[]` belong in the default view.
  const filtered = showAll
    ? result.inventory
    : result.inventory.filter((h) => h.evidence.length > 0);

  if (filtered.length === 0) {
    // Differentiate "no candidates at all" from "candidates exist but none
    // looked webhook-y" — the second case is a real signal that the engine
    // found POST routes (auth/cron/etc) but rejected them as non-webhooks.
    if (!showAll && result.inventory.length > 0) {
      return `No webhook handlers detected (${result.inventory.length} route candidate${result.inventory.length === 1 ? "" : "s"} carried no webhook evidence — run with --all to list).\n`;
    }
    return EMPTY_MESSAGE;
  }

  const sorted = [...filtered].sort((a, b) => {
    if (a.file_path !== b.file_path) return a.file_path < b.file_path ? -1 : 1;
    if (a.route_pattern < b.route_pattern) return -1;
    if (a.route_pattern > b.route_pattern) return 1;
    return 0;
  });
  const rows = sorted.map((h) => buildRow(h, opts));
  const wFw = Math.max("framework".length, ...rows.map((r) => r.framework.length));
  const wRoute = Math.max("route_pattern".length, ...rows.map((r) => r.route.length));
  const wProv = Math.max("provider".length, ...rows.map((r) => r.provider.length));
  const wState = Math.max("state".length, ...rows.map((r) => r.stateRaw.length));
  const wFile = Math.max("file:line".length, ...rows.map((r) => r.fileRaw.length));
  // evidence column is fixed-width (typically 1 digit, occasional 2-3)
  const wEv = showEvidence
    ? Math.max("evidence".length, ...rows.map((r) => String(r.evidence).length))
    : 0;

  const headerText = showEvidence
    ? `${pad("framework", wFw)}  ${pad("route_pattern", wRoute)}  ${pad("provider", wProv)}  ${pad("state", wState)}  ${pad("file:line", wFile)}  ${pad("evidence", wEv)}`
    : `${pad("framework", wFw)}  ${pad("route_pattern", wRoute)}  ${pad("provider", wProv)}  ${pad("state", wState)}  file:line`;
  const header = opts.useAnsi ? `${BOLD_ON}${headerText}${BOLD_OFF}` : headerText;
  const sep = showEvidence
    ? `${"─".repeat(wFw)}  ${"─".repeat(wRoute)}  ${"─".repeat(wProv)}  ${"─".repeat(wState)}  ${"─".repeat(wFile)}  ${"─".repeat(wEv)}`
    : `${"─".repeat(wFw)}  ${"─".repeat(wRoute)}  ${"─".repeat(wProv)}  ${"─".repeat(wState)}  ${"─".repeat(wFile)}`;

  const lines: string[] = [];
  lines.push(header);
  lines.push(dim(sep, opts));
  for (const r of rows) {
    const fwCell = pad(r.framework, wFw);
    const routeCell = pad(r.route, wRoute);
    const provCell = pad(r.provider, wProv);
    const statePad = " ".repeat(Math.max(0, wState - r.stateRaw.length));
    const stateCell = `${r.state}${statePad}`;
    const fileCell = r.fileLink;
    if (showEvidence) {
      const fileColPad = " ".repeat(Math.max(0, wFile - r.fileRaw.length));
      const evCell = pad(String(r.evidence), wEv);
      lines.push(
        `${fwCell}  ${routeCell}  ${provCell}  ${stateCell}  ${fileCell}${fileColPad}  ${dim(evCell, opts)}`,
      );
    } else {
      lines.push(`${fwCell}  ${routeCell}  ${provCell}  ${stateCell}  ${fileCell}`);
    }
  }
  // Footer hint when the filter dropped rows — surface the count so users know
  // there's more if they want it (and the wedge-vs-grep promise stays visible).
  if (!showAll) {
    const dropped = result.inventory.length - filtered.length;
    if (dropped > 0) {
      lines.push(
        dim(
          `(${dropped} additional route candidate${dropped === 1 ? "" : "s"} suppressed — no webhook evidence; run with --all to list)`,
          opts,
        ),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
