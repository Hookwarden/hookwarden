// Phase 27 (RULES-GO-01) bespoke adapter: net/http Go webhook handlers. No router framework —
// a webhook handler is a `func(w http.ResponseWriter, r *http.Request)` whose body reads request
// data in a webhook-verification shape. Detection is heuristic, mirroring vanilla-php.ts: we count
// telltale RECEIVING signals and qualify on >= 1. The http handler SIGNATURE ALONE does NOT qualify
// (Pitfall 6 over-emission guard) — a plain handler that never reads the body/headers/HMAC is not a
// webhook receiver. Plan 27-05 FP measurement re-tunes the threshold if over-emission shows up.
//
// Import-negative-gated: files importing chi/gin/echo are owned by chi-gin-echo-go.ts (the
// framework-gated adapter that runs first), exactly as vanilla-php yields to symfony.
//
// Pure: tree-sitter trees + ParsedFile only. No node:* import — basename math is inline string
// slicing to preserve engine purity (D-01). The adapter re-declares its own structural node type so
// it never imports web-tree-sitter.

import type { CandidateHandler } from "../model/catalog.js";
import type { SourceLocation } from "../types/finding.js";
import type { Framework } from "../types/handler.js";
import type { ParsedFile } from "../types/project-model.js";

interface GoSyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: ReadonlyArray<GoSyntaxNode>;
  childForFieldName(name: string): GoSyntaxNode | null;
  descendantsOfType(types: string | ReadonlyArray<string>): ReadonlyArray<GoSyntaxNode>;
}

// Router frameworks that own their own adapter (chi-gin-echo-go.ts). A file importing one of these
// is NOT a vanilla net/http handler — yield to the framework-gated adapter.
const FRAMEWORK_PREFIXES: ReadonlyArray<string> = [
  "github.com/go-chi/chi",
  "github.com/gin-gonic/gin",
  "github.com/labstack/echo",
];

// Receiving-signal detectors over a function body's source text. Each marks a distinct signal.
// (a) raw-body read: io.ReadAll / ioutil.ReadAll (almost always over r.Body in a handler).
const RE_BODY_READ = /\b(?:io|ioutil)\.ReadAll\s*\(/;
// (b) HMAC construction.
const RE_HMAC = /\bhmac\.New\s*\(/;
// (c) signature-header read: r.Header.Get("...Signature...") (case-insensitive on the header name).
const RE_SIGNATURE_HEADER = /\.Header\.Get\s*\(\s*"[^"]*[Ss]ignature[^"]*"\s*\)/;
// (d) a known Go webhook-SDK verify call — SDK-delegated handlers read the body + signature inside
// the SDK, so they carry none of (a)/(b)/(c) but are unambiguously webhook receivers
// (stripe-go webhook.ConstructEvent, go-github ValidatePayload/ValidateSignature, svix wh.Verify).
const RE_SDK_VERIFY =
  /\.(ConstructEvent|ConstructEventWithTolerance|ConstructEventIgnoringTolerance|ValidatePayload|ValidateSignature|Verify)\s*\(/;

export function netHttpGoAdapter(
  file: ParsedFile,
  _allFiles: ReadonlyArray<ParsedFile>,
): ReadonlyArray<CandidateHandler> {
  if (file.dialect !== "tree-sitter-go") return [];
  if (file.parse_error !== null || file.raw_ast === null) return [];
  if (file.imports.some((i) => FRAMEWORK_PREFIXES.some((p) => i.to_module.startsWith(p)))) {
    return [];
  }

  const tree = file.raw_ast as { rootNode: GoSyntaxNode };
  const routePattern = deriveRoute(file.file_path);
  const out: CandidateHandler[] = [];
  const emittedRanges: Array<{ start: number; end: number }> = [];

  // Named handlers first (function_declaration + method_declaration), then anonymous func_literals
  // (e.g. `http.HandleFunc("/x", func(w, r){...})`) that are NOT already inside an emitted named
  // handler — byte-range containment dedup prevents double-emission.
  const named = tree.rootNode.descendantsOfType(["function_declaration", "method_declaration"]);
  for (const fn of named) {
    const cand = tryEmit(fn, file, routePattern);
    if (cand !== null) {
      out.push(cand);
      emittedRanges.push({ start: fn.startIndex, end: fn.endIndex });
    }
  }
  for (const lit of tree.rootNode.descendantsOfType(["func_literal"])) {
    if (emittedRanges.some((r) => lit.startIndex >= r.start && lit.endIndex <= r.end)) continue;
    const cand = tryEmit(lit, file, routePattern);
    if (cand !== null) {
      out.push(cand);
      emittedRanges.push({ start: lit.startIndex, end: lit.endIndex });
    }
  }
  return out;
}

function tryEmit(
  fn: GoSyntaxNode,
  file: ParsedFile,
  routePattern: string,
): CandidateHandler | null {
  if (!isHttpHandlerSignature(fn)) return null;
  const body = fn.childForFieldName("body");
  if (body === null) return null;
  if (countReceivingSignals(body.text) < 1) return null;

  const nameNode = fn.childForFieldName("name");
  return {
    framework: "net-http-go" as Framework,
    framework_version: null,
    route_pattern: routePattern,
    http_methods: ["POST"],
    file_path: file.file_path,
    location: locOf(fn),
    handler_function_name: nameNode?.text ?? null,
    handler_body_node: fn,
    handler_source_start: fn.startIndex,
    handler_source_end: fn.endIndex,
  };
}

// A net/http handler signature carries an http.ResponseWriter and an *http.Request parameter.
// Param names vary (w/rw, r/req) — match on the types in the parameter list text.
function isHttpHandlerSignature(fn: GoSyntaxNode): boolean {
  const params = fn.childForFieldName("parameters");
  if (params === null) return false;
  const text = params.text;
  return text.includes("http.ResponseWriter") && text.includes("http.Request");
}

function countReceivingSignals(bodyText: string): number {
  let count = 0;
  if (RE_BODY_READ.test(bodyText)) count++;
  if (RE_HMAC.test(bodyText)) count++;
  if (RE_SIGNATURE_HEADER.test(bodyText)) count++;
  if (RE_SDK_VERIFY.test(bodyText)) count++;
  return count;
}

// Derive `/<basename-without-ext>` from a file path (mirrors vanilla-php deriveRoute). Pure string
// math — no node:path import (engine purity D-01).
function deriveRoute(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  const basename = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
  const noExt = basename.endsWith(".go") ? basename.slice(0, -3) : basename;
  return `/${noExt}`;
}

function locOf(n: GoSyntaxNode): SourceLocation {
  return {
    line: n.startPosition.row + 1,
    col: n.startPosition.column + 1,
    end_line: n.endPosition.row + 1,
    end_col: n.endPosition.column + 1,
  };
}
