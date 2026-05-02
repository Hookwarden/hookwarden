// D-25: Hybrid normalization layer — ParsedFile retains raw AST plus normalized concepts.
// D-26: Normalized layer = WebhookHandler + MiddlewareChain + ImportEdge ONLY in v1.
// D-27: Parse errors are all-or-nothing — one parse-error Finding per failed file.

import type { WebhookHandler } from "./handler.ts";

// Opaque to consumers. Each parser stamps its own dialect ("babel" | "tree-sitter-python").
// Engine internals down-cast based on `dialect`. Public surface keeps the type opaque.
export interface ParsedFile {
  readonly file_path: string; // repo-relative
  readonly language: "javascript" | "typescript" | "python";
  readonly dialect: "babel" | "tree-sitter-python";
  readonly source_text: string; // raw source; redaction happens later
  readonly raw_ast: unknown; // dialect-specific AST root; engine parsers cast internally
  readonly imports: ReadonlyArray<ImportEdge>;
  readonly parse_error: ParseErrorRecord | null; // when set, this file produces ONE parse-error Finding (D-27)
}

// D-27 all-or-nothing parse-error record.
export interface ParseErrorRecord {
  readonly message: string;
  readonly location: { readonly line: number; readonly col: number };
  readonly source: "babel" | "tree-sitter";
}

// D-25 normalized concept #1.
export interface ImportEdge {
  readonly from_file: string;
  readonly to_module: string; // e.g. "stripe", "./middleware/webhooks"
  readonly imported_names: ReadonlyArray<{ readonly local: string; readonly source: string }>;
  readonly is_default: boolean;
}

// D-25 normalized concept #2 surfaced through ProjectModel.
export interface MiddlewareRegistration {
  readonly file_path: string;
  readonly framework: WebhookHandler["framework"];
  readonly app_symbol: string; // e.g. "app", "router"
  readonly call_site_position: number; // global ordering within the file
  readonly middleware_name: string;
  readonly import_source: string | null;
}

export interface ProjectModel {
  readonly parsed_files: ReadonlyArray<ParsedFile>;
  readonly handlers: ReadonlyArray<WebhookHandler>;
  readonly middleware_registrations: ReadonlyArray<MiddlewareRegistration>;
  readonly import_graph: ReadonlyArray<ImportEdge>;
}
