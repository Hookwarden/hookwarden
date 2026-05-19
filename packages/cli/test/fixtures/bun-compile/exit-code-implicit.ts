// Bug 1 informational fixture: assert whether `bun build --compile` honors
// implicit process.exitCode (set then natural exit). This was the original
// CLI pattern that surfaced bug 1 — Bun's compiled binary ignored the
// exitCode and exited 0 despite the value being set.
//
// Compiled with: bun build --compile <this-file> --outfile <out>
// Expected today: running <out> exits with code 0 (Bun still has the bug).
// If <out> exits with code 1, Bun has fixed the underlying issue and the
// explicit `process.exit(code)` workaround in the CLI can be removed.

process.stdout.write("implicit-exit-fixture: stdout drain\n");
process.exitCode = 1;
