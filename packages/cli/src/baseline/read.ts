// D-69 baseline auto-read: ENOENT → null (silent no-op when no baseline exists).
// Malformed JSON or schema-failing JSON throws — this is the surface that distinguishes
// "no baseline configured" (null) from "broken baseline" (error the user must fix).

import { promises as fs } from "node:fs";
import { type BaselineDocument, validateBaselineDocument } from "./schema.js";

export async function readBaseline(filePath: string): Promise<BaselineDocument | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`baseline JSON parse error in ${filePath}: ${(err as Error).message}`);
  }
  return validateBaselineDocument(parsed);
}
