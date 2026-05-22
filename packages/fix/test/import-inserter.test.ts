// Phase 8.2 Plan 08 Task 2: D-11 condition 4 import-inserter tests.

import { describe, expect, it } from "vitest";
import { parseJsTs } from "@hookwarden/engine";
import { insertImports } from "../src/import-inserter.js";

describe("insertImports — JS/TS", () => {
  it("inserts `import crypto from \"node:crypto\";` at byte 0 when no imports exist", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const edits = insertImports(parsed, [
      { specifier: "node:crypto", default_name: "crypto" },
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.startByte).toBe(0);
    expect(edits[0]?.endByte).toBe(0);
    expect(edits[0]?.after).toBe('import crypto from "node:crypto";\n');
  });

  it("preserves shebang — insertion at start of line 2", async () => {
    const src = "#!/usr/bin/env node\nconst x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const edits = insertImports(parsed, [
      { specifier: "node:crypto", default_name: "crypto" },
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.startByte).toBe("#!/usr/bin/env node\n".length);
  });

  it("idempotent — returns empty edits when crypto is already imported", async () => {
    const src = 'import crypto from "node:crypto";\nconst x = 1;\n';
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const edits = insertImports(parsed, [
      { specifier: "node:crypto", default_name: "crypto" },
    ]);
    expect(edits).toHaveLength(0);
  });
});
