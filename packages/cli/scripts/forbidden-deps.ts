// CLI-09: bundle inspection deny-list. Single source of truth (specifics §"Bundle-inspection deny-list is one source of truth").
// inspect-bundle.ts reads from here; docs reference these names.
// Phase 5+ extensions edit one file.

/**
 * Node built-in modules whose presence in the published bundle indicates network capability.
 * The hookwarden CLI must not perform any outbound network I/O during normal scan operation.
 */
export const FORBIDDEN_NETWORK_BUILTIN: ReadonlyArray<string> = [
  "http",
  "https",
  "net",
  "dgram",
  "tls",
  "dns",
];

/**
 * Third-party HTTP clients that, if present in the bundle, indicate the CLI is making
 * outbound HTTP calls. Listed verbatim in ROADMAP.md Phase 4 success criterion 6:
 *   "fails any release whose final tarball references http, https, node-fetch, axios, got,
 *    or any analytics SDK"
 * Phase 4 additions (decisions §Discretion §"Bundle-inspection forbidden-deps list"):
 *   undici, phin, superagent, plus a few more typical CLI HTTP picks.
 */
export const FORBIDDEN_HTTP_CLIENTS: ReadonlyArray<string> = [
  "node-fetch",
  "axios",
  "got",
  "undici",
  "phin",
  "superagent",
  "cross-fetch",
  "isomorphic-fetch",
  "ky",
  "wretch",
  "needle",
  "request",
];

/**
 * Analytics / observability SDK patterns. Captures the obvious ones; the list is
 * non-exhaustive by design — the goal is to catch additions during code review,
 * not to enumerate every analytics SDK ever published.
 *
 * Each entry is a regex matched against an import specifier (NOT the surrounding
 * source line). Anchors (`^`/`$`) are required so partial-name false positives
 * (e.g., `mixpanel` substring inside `my-mixpanel-stub`) do not fire.
 */
export const FORBIDDEN_ANALYTICS_SDK_PATTERNS: ReadonlyArray<RegExp> = [
  /^mixpanel$/,
  /^posthog-[\w-]+$/,
  /^@segment\/[\w-]+$/,
  /^@datadog\/[\w-]+$/,
  /^@sentry\/[\w-]+$/,
  /^@amplitude\/[\w-]+$/,
  /^@bugsnag\/[\w-]+$/,
  /^bugsnag$/,
  /^amplitude$/,
  /^analytics-node$/,
  /^heap-node$/,
  /^@logsnag\/[\w-]+$/,
  /^loggly-jslogger$/,
  /^rollbar$/,
  /^honeycomb-beeline$/,
  /^appsignal$/,
];

/**
 * Returns true if the given module specifier matches any forbidden entry.
 * Used by both inspect-bundle.ts (for tarball scanning) and the unit tests.
 *
 * Strips a leading `node:` prefix when comparing against the network-builtin list
 * so `node:http` and `http` both resolve.
 */
export function isForbiddenImport(specifier: string): boolean {
  const stripped = specifier.replace(/^node:/, "");
  if (FORBIDDEN_NETWORK_BUILTIN.includes(stripped)) return true;
  if (FORBIDDEN_HTTP_CLIENTS.includes(specifier)) return true;
  for (const pattern of FORBIDDEN_ANALYTICS_SDK_PATTERNS) {
    if (pattern.test(specifier)) return true;
  }
  return false;
}

/**
 * Escape regex metacharacters in a literal package name so it can be embedded in a
 * larger character class / alternation safely.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a category-tagged set of regexes for the bundle inspector.
 * Each regex matches the three import shapes — `require("lib")`, `from "lib"`,
 * `import "lib"` (bare side-effect) — and accepts an optional `node:` prefix on
 * built-in module specifiers.
 *
 * Returned in stable order so inspect-bundle output is deterministic.
 */
export function buildCategoryRegexes(): ReadonlyArray<{ category: string; pattern: RegExp }> {
  const builtinAlt = FORBIDDEN_NETWORK_BUILTIN.map(escapeRegex).join("|");
  const clientAlt = FORBIDDEN_HTTP_CLIENTS.map(escapeRegex).join("|");
  const analyticsAlt = FORBIDDEN_ANALYTICS_SDK_PATTERNS.map((r) =>
    r.source.replace(/^\^/, "").replace(/\$$/, ""),
  ).join("|");

  const importShape = String.raw`\b(?:require\(\s*|from\s+|import\s+)["']`;

  return [
    {
      category: "network-builtin",
      pattern: new RegExp(`${importShape}(?:node:)?(?:${builtinAlt})["']`),
    },
    {
      category: "network-http-client",
      pattern: new RegExp(`${importShape}(?:${clientAlt})["']`),
    },
    {
      category: "analytics-sdk",
      pattern: new RegExp(`${importShape}(?:${analyticsAlt})["']`),
    },
  ];
}

/**
 * Build a single combined regex matching any forbidden import (any category).
 * The result has the `g` flag so callers can `matchAll` to enumerate offenders.
 *
 * Deterministic: repeated calls return regexes with identical `source`.
 */
export function buildForbiddenImportRegex(): RegExp {
  const builtinAlt = FORBIDDEN_NETWORK_BUILTIN.map(escapeRegex).join("|");
  const clientAlt = FORBIDDEN_HTTP_CLIENTS.map(escapeRegex).join("|");
  const analyticsAlt = FORBIDDEN_ANALYTICS_SDK_PATTERNS.map((r) =>
    r.source.replace(/^\^/, "").replace(/\$$/, ""),
  ).join("|");

  const allParts = `(?:node:)?(?:${builtinAlt})|${clientAlt}|${analyticsAlt}`;
  const source = String.raw`\b(?:require\(\s*|from\s+|import\s+)["'](?:${allParts})["']`;
  return new RegExp(source, "g");
}
