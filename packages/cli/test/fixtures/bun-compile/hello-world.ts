// Bug 3 fixture: a maximally-vanilla TS source for `bun build --compile`.
// Used to probe whether Bun embeds its "popular packages needing build
// scripts" reference list (and similar internal constants) as literal
// strings in the compiled binary — independent of user source code.
//
// If the compiled binary contains forbidden-deps names like `axios`,
// `got`, `undici` etc. (from packages/cli/scripts/forbidden-deps.ts),
// the binary-level forbidden-deps scan is unreliable and must stay
// disabled (release-binaries.yml DC-19 step gate, fixed at 8fa5826).
//
// Compiled with: bun build --compile <this-file> --outfile <out>

console.log("hello, world");
