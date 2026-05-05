// Single source of truth for engine version. Changesets keeps this in lockstep with
// package.json (D-05). Update both fields at the same commit. Plan 02-09 adds a CI gate
// that asserts they match.
export const ENGINE_VERSION = "0.2.0";
