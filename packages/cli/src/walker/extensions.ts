// D-51: extension allowlist applied before invoking the parser. Files outside the allowlist
// are counted into total_files_count (for ScanMetadata.total_files_count) but not into
// parsed_files_count_estimate. Keeps the parse-error policy (D-27) from emitting noise on
// README/JSON/SVG/etc.

export const EXTENSION_ALLOWLIST: ReadonlySet<string> = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".jsx",
  ".ts",
  ".cts",
  ".mts",
  ".tsx",
  ".py",
  ".pyi",
  ".php",
]);

export function isAllowlistedFile(filePath: string): boolean {
  const idx = filePath.lastIndexOf(".");
  if (idx < 0) return false;
  return EXTENSION_ALLOWLIST.has(filePath.slice(idx).toLowerCase());
}
