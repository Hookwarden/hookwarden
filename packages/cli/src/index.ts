// hookwarden CLI entry. Phase 3 implements the scan subcommand.
import { evaluate } from "@hookwarden/engine";

export async function main(_argv: string[]): Promise<number> {
  await evaluate({}, {}, {});
  return 0;
}
