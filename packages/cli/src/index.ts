// hookwarden CLI entry. Phase 3 implements the scan subcommand.
import { evaluate } from "@hookwarden/engine";

export async function main(_argv: string[]): Promise<number> {
  const findings = await evaluate({}, {}, {});
  console.log(`hookwarden v0.0.0 — ${findings.length} findings (placeholder)`);
  return 0;
}
