// RULES-03 cross-cutting predicate. Detects the canonical Express middleware-ordering bug:
// `app.use(express.json())` registered BEFORE a webhook route, which parses the body as JSON
// before signature verification reads the raw bytes. Verification then fails on every webhook.
//
// Pure: no fs / http / network / process / node:*. Receives WebhookHandler + ProjectModel; returns
// Verdict | null. Returns null when the rule does not apply (handler is non-Express OR the bug
// pattern is absent — other rules emit not-verified for missing verification overall).
//
// D-36: handler.middleware_chain is ordered by registration position (0-indexed). By contract,
// the chain holds the registrations effective for THIS route, so any JSON body parser appearing
// in the chain is the bug.

import type {
  ProjectModel,
  ResolvedMiddleware,
  RulePredicate,
  WebhookHandler,
} from "@hookwarden/engine";

const JSON_PARSER_NAMES: ReadonlySet<string> = new Set([
  "express.json",
  "bodyParser.json",
  "body-parser.json",
]);

const JSON_PARSER_IMPORT_SOURCES: ReadonlySet<string> = new Set(["express", "body-parser"]);

function isJsonBodyParser(mw: ResolvedMiddleware): boolean {
  if (JSON_PARSER_NAMES.has(mw.name)) return true;
  // Catch alias forms like `json` imported directly from express or body-parser.
  if (
    mw.name === "json" &&
    mw.import_source !== null &&
    JSON_PARSER_IMPORT_SOURCES.has(mw.import_source)
  ) {
    return true;
  }
  return false;
}

export const expressMiddlewareOrderingPredicate: RulePredicate = async (
  handler: WebhookHandler,
  _model: ProjectModel,
) => {
  if (handler.framework !== "express") return null;
  if (handler.middleware_chain.length === 0) return null;

  const jsonParserIdx = handler.middleware_chain.findIndex(isJsonBodyParser);
  if (jsonParserIdx < 0) return null;

  return "not-verified";
};
