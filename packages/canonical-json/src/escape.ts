/**
 * RFC 8785 §3.2.2.2 String escape.
 *
 * Rules (in order of precedence):
 *   - U+0008 (backspace)      → "\b"
 *   - U+0009 (horizontal tab) → "\t"
 *   - U+000A (line feed)      → "\n"
 *   - U+000C (form feed)      → "\f"
 *   - U+000D (carriage return)→ "\r"
 *   - U+0022 (quote)          → "\""
 *   - U+005C (backslash)      → "\\"
 *   - Other control chars below U+0020 → "\uXXXX" (lower-case hex per RFC 8785)
 *   - All other code units (including surrogate halves) → pass-through.
 *
 * The output does NOT include the surrounding quotes — the caller wraps.
 *
 * Per RFC 8785, the JSON string is produced from the JS string's UTF-16
 * code-unit sequence directly. Characters in the supplementary plane
 * (U+10000+) are stored as a surrogate pair in JS strings and emit as
 * two pass-through code units, which is exactly what RFC 8785 requires.
 *
 * This function does NOT call `JSON.stringify`. The package IS the
 * alternative to `JSON.stringify` (D-19).
 */
export function escapeString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    switch (code) {
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += "\\\\";
        break;
      default:
        if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          // Pass-through one UTF-16 code unit. For a supplementary-plane
          // character (e.g., U+1F600), this loop emits the high surrogate
          // at position i and the low surrogate at position i+1 — together
          // they encode to a single UTF-8 codepoint in the output bytes,
          // which is exactly what RFC 8785 §3.2.2.2 requires.
          out += s[i];
        }
        break;
    }
  }
  return out;
}
