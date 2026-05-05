// Internal helpers shared across catalog-parameterized predicate factories. The same
// "manual HMAC entry" / "constant-time compare" / "timestamp symbol" / "SDK verify match"
// shapes appear in 4+ factories — extract once, narrow names so accidental imports from
// outside this module are obvious in diffs.
//
// Pure: no fs / http / network / process / node:*. Required by .dependency-cruiser.cjs
// rules-predicates-no-node-core + rules-predicates-no-network-libs (D-28).

import type { ReachableSymbol } from "@hookwarden/engine";

// `crypto.createHmac` (Node) / `hmac.new` (Python stdlib). The endsWith form catches aliased
// imports like `import { createHmac } from 'node:crypto'` where the qualified name walks
// through the import binding (e.g. `mod.createHmac`).
export function isManualHmacEntry(name: string): boolean {
  return (
    name === "crypto.createHmac" ||
    name.endsWith(".createHmac") ||
    name === "hmac.new" ||
    name.endsWith(".hmac.new")
  );
}

// `crypto.timingSafeEqual` (Node) / `hmac.compare_digest` (Python stdlib).
export function isConstantTimeCompare(name: string): boolean {
  return (
    name === "crypto.timingSafeEqual" ||
    name.endsWith(".timingSafeEqual") ||
    name === "hmac.compare_digest" ||
    name.endsWith(".compare_digest")
  );
}

// Date / time / int symbols that gate timestamp-tolerance comparisons.
const TIMESTAMP_SYMBOLS: ReadonlyArray<string> = [
  "Date.now",
  "Date.parse",
  "time.time",
  "time.monotonic",
  "datetime.utcnow",
  "datetime.now",
];

export function isTimestampSymbol(name: string): boolean {
  for (const t of TIMESTAMP_SYMBOLS) {
    if (name === t || name.endsWith(`.${t}`)) return true;
  }
  return false;
}

// Match a reachable symbol against an SDK verify-call list, with import-source narrowing
// per D-91 + PATTERNS analog 3. When `sdkPackages` is non-empty AND the symbol has a non-null
// `import_source`, the import_source MUST be in `sdkPackages` for the symbol to count as a
// verify match — this rejects e.g. `verify` from `@some-other/lib` while accepting it from
// `@octokit/webhooks`. Symbols with `import_source === null` (engine could not resolve the
// import) are accepted on qualified-name match alone — the engine's own resolution is the
// gating signal, not the predicate's. This preserves the pre-Phase-6 Stripe semantics
// (qualified name `stripe.webhooks.constructEvent` is specific enough on its own) while
// adding the GitHub-style anchor for symbols whose import_source IS resolved but wrong.
export function reachesSdkVerifyCall(
  symbols: ReadonlyArray<ReachableSymbol>,
  sdkVerifyCalls: ReadonlyArray<string>,
  sdkPackages: ReadonlyArray<string>,
): boolean {
  if (sdkVerifyCalls.length === 0) return false;
  const packagesSet = sdkPackages.length > 0 ? new Set(sdkPackages) : null;
  for (const sym of symbols) {
    if (packagesSet !== null && sym.import_source !== null && !packagesSet.has(sym.import_source)) {
      continue;
    }
    for (const call of sdkVerifyCalls) {
      if (sym.qualified_name === call || sym.qualified_name.endsWith(`.${call}`)) {
        return true;
      }
    }
  }
  return false;
}
