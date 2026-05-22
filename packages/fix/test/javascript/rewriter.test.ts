// Phase 8.2 Plan 03 Task 3: JS/TS rewriter — babel parsedFile + mask + applier.
//
// Includes the W9 byte-equal-outside-applied-range invariant test — the empirical
// proof that text-range substitution preserves formatting outside the rewrite.

import { parseJsTs } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { buildForbiddenRanges } from "../../src/forbidden-ranges.js";
import type { FixEdit } from "../../src/index.js";
import { rewriteJavascript } from "../../src/javascript/rewriter.js";

function mkEdit(
  overrides: Partial<FixEdit> & Pick<FixEdit, "startByte" | "endByte" | "after">,
): FixEdit {
  return {
    ruleId: "test/rule",
    routineId: "test-routine",
    filePath: "x.ts",
    start: { line: 1, col: 1 },
    end: { line: 1, col: 1 },
    before: "",
    safety: "safe",
    ...overrides,
  };
}

describe("rewriteJavascript — positive cases", () => {
  it("applies 1 valid edit", async () => {
    const src = "const a = b === c;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const replaceStart = src.indexOf("b === c");
    const replaceEnd = replaceStart + "b === c".length;
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: replaceStart,
          endByte: replaceEnd,
          before: "b === c",
          after: "timingSafeEqual(Buffer.from(b), Buffer.from(c))",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.newSource).toBe("const a = timingSafeEqual(Buffer.from(b), Buffer.from(c));\n");
  });

  it("applies 3 valid edits on distinct lines (right-to-left preserves offsets)", async () => {
    const src = "const a = b === c;\nconst d = e === f;\nconst g = h === i;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const edits: FixEdit[] = ["b === c", "e === f", "h === i"].map((needle) => {
      const start = src.indexOf(needle);
      return mkEdit({
        startByte: start,
        endByte: start + needle.length,
        before: needle,
        after: needle.replace(" === ", " ==SAFE== "),
      });
    });
    const result = rewriteJavascript({ parsedFile: parsed, edits, forbiddenRanges: mask });
    expect(result.applied).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
    expect(result.newSource).toContain("b ==SAFE== c");
    expect(result.newSource).toContain("e ==SAFE== f");
    expect(result.newSource).toContain("h ==SAFE== i");
  });

  it("returns newSource === input when edits is empty", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const result = rewriteJavascript({ parsedFile: parsed, edits: [], forbiddenRanges: mask });
    expect(result.newSource).toBe(src);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});

describe("rewriteJavascript — negative cases (rejections)", () => {
  it("rejects edit that intersects a template literal", async () => {
    const src = "const a = `b === c is the comparison`;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const replaceStart = src.indexOf("b === c");
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: replaceStart,
          endByte: replaceStart + "b === c".length,
          before: "b === c",
          after: "timingSafeEqual(b, c)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
    expect(result.newSource).toBe(src);
  });

  it("rejects edit that intersects a comment", async () => {
    const src = "const x = 1; // b === c\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const commentStart = src.indexOf("b === c");
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: commentStart,
          endByte: commentStart + "b === c".length,
          before: "b === c",
          after: "timingSafeEqual(b, c)",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("forbidden-range");
  });

  it("rejects edit spanning 2 source lines (D-07)", async () => {
    const src = "const a =\nb;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: 0,
          endByte: 12,
          before: src.slice(0, 12),
          after: "const a = b;",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("multi-line");
  });

  it("rejects edit with endByte > source.length", async () => {
    const src = "const x = 1;\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte: 0,
          endByte: 9999,
          before: "x",
          after: "y",
        }),
      ],
      forbiddenRanges: mask,
    });
    expect(result.rejected[0]?.reason).toBe("out-of-bounds");
  });
});

describe("rewriteJavascript — pre-condition violations", () => {
  it("throws TypeError when dialect is not babel", async () => {
    const src = "x = 1\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    // Construct a fake non-babel parsedFile.
    const fake = { ...parsed, dialect: "tree-sitter-python" as const };
    expect(() => rewriteJavascript({ parsedFile: fake, edits: [], forbiddenRanges: [] })).toThrow(
      TypeError,
    );
  });

  it("throws when parse_error is non-null", async () => {
    const src = "const x = ;\n"; // invalid syntax
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    expect(parsed.parse_error).not.toBeNull();
    expect(() => rewriteJavascript({ parsedFile: parsed, edits: [], forbiddenRanges: [] })).toThrow(
      /refusing to rewrite.*parse error/,
    );
  });
});

describe("rewriteJavascript — W9 byte-equal outside applied range", () => {
  it("single edit: prefix + suffix byte-equal to input outside [start, end)", async () => {
    const padding = "X".repeat(50);
    const src = `${padding}b === c${padding}`;
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const startByte = padding.length;
    const endByte = startByte + "b === c".length;
    const after = "timingSafeEqual(Buffer.from(b), Buffer.from(c))";
    const result = rewriteJavascript({
      parsedFile: parsed,
      edits: [
        mkEdit({
          startByte,
          endByte,
          before: "b === c",
          after,
        }),
      ],
      forbiddenRanges: mask,
    });
    // Prefix: bytes [0, startByte) must be byte-equal.
    expect(result.newSource.slice(0, startByte)).toBe(src.slice(0, startByte));
    // Suffix: bytes after the new edit endpoint must equal bytes after input endByte.
    expect(result.newSource.slice(startByte + after.length)).toBe(src.slice(endByte));
  });

  it("multi-edit: per-edit byte-equal outside range with cumulative offset accounting", async () => {
    const src = "line1: b === c\nline2: e === f\nline3: h === i\n";
    const parsed = await parseJsTs({ file_path: "x.ts", source_text: src });
    const mask = buildForbiddenRanges(parsed);
    const needles = ["b === c", "e === f", "h === i"];
    const afterFor = (n: string) => n.replace(" === ", " ==SAFE== "); // +6 bytes each
    const edits: FixEdit[] = needles.map((needle) => {
      const startByte = src.indexOf(needle);
      return mkEdit({
        startByte,
        endByte: startByte + needle.length,
        before: needle,
        after: afterFor(needle),
      });
    });
    const result = rewriteJavascript({ parsedFile: parsed, edits, forbiddenRanges: mask });
    expect(result.applied).toHaveLength(3);

    // Verify each edit lands at its expected post-shift offset AND that the
    // un-edited segments between edits are byte-equal to the corresponding
    // input segments. Edits are applied right-to-left, so the cumulative
    // shift at each edit equals the sum of (after-before) deltas from
    // edits whose startByte is LESS than this edit's startByte.
    const sortedAscending = [...edits].sort((a, b) => a.startByte - b.startByte);
    let runningShift = 0;
    let prevInputCursor = 0;
    for (const edit of sortedAscending) {
      // Segment from previous cursor (input space) → edit.startByte (input space)
      // must appear unchanged in the result, shifted by runningShift.
      const inputSegment = src.slice(prevInputCursor, edit.startByte);
      const resultSegment = result.newSource.slice(
        prevInputCursor + runningShift,
        edit.startByte + runningShift,
      );
      expect(resultSegment).toBe(inputSegment);
      // The edit's `after` string must appear starting at edit.startByte + runningShift.
      expect(
        result.newSource.slice(
          edit.startByte + runningShift,
          edit.startByte + runningShift + edit.after.length,
        ),
      ).toBe(edit.after);
      runningShift += edit.after.length - (edit.endByte - edit.startByte);
      prevInputCursor = edit.endByte;
    }
    // Trailing segment after the last edit's input end → input EOF.
    expect(result.newSource.slice(prevInputCursor + runningShift)).toBe(src.slice(prevInputCursor));
  });
});
