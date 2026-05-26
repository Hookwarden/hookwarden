// DISCOVERY-01: tabular `hookwarden inventory` output — framework | route_pattern | provider | state | file:line.
// Pure: returns a single string. CLI shell (Plan 07) is the only place that writes to stdout.
//
// D-42 state badge gates color on useAnsi. D-43 OSC-8 hyperlinks degrade to plain file:line text.

import * as path from "node:path";
import type { ScanResult, WebhookHandler } from "@hookwarden/engine";
import { ansiLink, dim, stateBadge } from "./colors.js";

export interface RenderInventoryOptions {
  readonly useAnsi: boolean;
  readonly cwd: string;
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
  };
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

const BOLD_ON = "\x1b[1m";
const BOLD_OFF = "\x1b[0m";

export function renderInventory(result: ScanResult, opts: RenderInventoryOptions): string {
  if (result.inventory.length === 0) return EMPTY_MESSAGE;
  const sorted = [...result.inventory].sort((a, b) => {
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

  const headerText = `${pad("framework", wFw)}  ${pad("route_pattern", wRoute)}  ${pad("provider", wProv)}  ${pad("state", wState)}  file:line`;
  const header = opts.useAnsi ? `${BOLD_ON}${headerText}${BOLD_OFF}` : headerText;
  const sep = `${"─".repeat(wFw)}  ${"─".repeat(wRoute)}  ${"─".repeat(wProv)}  ${"─".repeat(wState)}  ${"─".repeat(wFile)}`;

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
    lines.push(`${fwCell}  ${routeCell}  ${provCell}  ${stateCell}  ${fileCell}`);
  }
  return `${lines.join("\n")}\n`;
}
