// D-39: structural snippet redaction. Literals → typed placeholders; identifiers preserved.
// Browser-safe: pure string transformation, no Node built-ins.
// Property-tested: every string literal becomes <STRING:N>; every identifier is unchanged.

export type LiteralKind =
  | "string" // → "<STRING:LEN>" (length preserved as a hint per D-39)
  | "number" // → "<NUMBER>"
  | "template" // → "<TEMPLATE>"
  | "regex" // → "<REGEX>"
  | "secret"; // → "<SECRET_LITERAL>" — D-33 catalog match overrides "string"

export interface LiteralSpan {
  readonly kind: LiteralKind;
  readonly start: number; // byte offset into source_text, 0-indexed
  readonly end: number; // exclusive
  readonly value: string; // the original source slice; redactor uses .length only for `<STRING:N>`
}

export interface RedactionInput {
  readonly source_text: string; // the pretty-printed AST slice
  readonly literals: ReadonlyArray<LiteralSpan>;
  // Optional secret-literal allowlist — when a string literal's value starts with one of these
  // prefixes, the redactor emits <SECRET_LITERAL> instead of <STRING:N>.
  readonly secret_literal_prefixes?: ReadonlyArray<string>;
}

// Sort spans descending by start so we can splice without shifting indices.
function sortSpans(spans: ReadonlyArray<LiteralSpan>): ReadonlyArray<LiteralSpan> {
  return [...spans].sort((a, b) => b.start - a.start);
}

function placeholderFor(span: LiteralSpan, secretPrefixes: ReadonlyArray<string>): string {
  if (span.kind === "secret") return "<SECRET_LITERAL>";
  if (span.kind === "string") {
    for (const prefix of secretPrefixes) {
      if (span.value.startsWith(prefix)) return "<SECRET_LITERAL>";
    }
    return `<STRING:${span.value.length}>`;
  }
  if (span.kind === "number") return "<NUMBER>";
  if (span.kind === "template") return "<TEMPLATE>";
  if (span.kind === "regex") return "<REGEX>";
  // Exhaustiveness: every LiteralKind covered above.
  const _exhaustive: never = span.kind;
  return `<UNKNOWN:${_exhaustive as string}>`;
}

export function redactSnippet(input: RedactionInput): string {
  const secretPrefixes = input.secret_literal_prefixes ?? [];
  let out = input.source_text;
  for (const span of sortSpans(input.literals)) {
    const placeholder = placeholderFor(span, secretPrefixes);
    out = out.slice(0, span.start) + placeholder + out.slice(span.end);
  }
  return out;
}
