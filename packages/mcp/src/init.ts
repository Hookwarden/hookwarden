// Stub for Plan 23-06's `npx @hookwarden/mcp init` helper. Plan 23-02 ships
// this so the single-bin dispatcher in cli.ts has a real import target;
// Plan 23-06 replaces the body with the per-client config writer.

export async function runInit(_argv: ReadonlyArray<string>): Promise<number> {
  process.stderr.write(
    "hookwarden-mcp init: not implemented in this build — landing in Plan 23-06.\n",
  );
  return 1;
}
