// Bug 1 negative-test fixture: assert `bun build --compile` honors
// explicit process.exit(N). Mirrors the CLI's actual exit-code pattern
// (packages/cli/src/index.ts after fix 7d2de0a — `process.exit(code)`
// after stdout drain).
//
// Compiled with: bun build --compile <this-file> --outfile <out>
// Expected: running <out> exits with code 1.

process.stdout.write("explicit-exit-fixture: stdout drain\n");
process.exit(1);
