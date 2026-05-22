// Phase 8.2 Plan 03 Task 2: pure text-range applier — right-to-left substitution.
//
// Per [[feedback_negative_tests_required]] — 5 negative cases prove the applier
// rejects degenerate / overlapping / out-of-bounds edits LOUDLY.

import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/text-range-applier.js";

describe("applyEdits — positive cases", () => {
  it("applies a single edit at the middle of the source", () => {
    const src = "hello world";
    const out = applyEdits(src, [{ start: 6, end: 11, replacement: "earth" }]);
    expect(out).toBe("hello earth");
  });

  it("applies 3 edits at distinct ranges (right-to-left preserves offsets)", () => {
    const src = "0123456789";
    const out = applyEdits(src, [
      { start: 0, end: 1, replacement: "A" },
      { start: 4, end: 5, replacement: "BBB" },
      { start: 8, end: 9, replacement: "C" },
    ]);
    expect(out).toBe("A123BBB567C9");
  });

  it("applies an edit at byte 0 (start of file)", () => {
    expect(applyEdits("foo", [{ start: 0, end: 3, replacement: "bar" }])).toBe("bar");
  });

  it("applies an edit at the end of file (start === sourceText.length, insertion)", () => {
    expect(applyEdits("foo", [{ start: 3, end: 3, replacement: "bar" }])).toBe("foobar");
  });

  it("applies an empty replacement (deletion)", () => {
    expect(applyEdits("foobar", [{ start: 3, end: 6, replacement: "" }])).toBe("foo");
  });

  it("returns input unchanged when edits is empty", () => {
    expect(applyEdits("hello", [])).toBe("hello");
  });
});

describe("applyEdits — negative cases (per feedback_negative_tests_required)", () => {
  it("throws when two edits have overlapping ranges (rule_ids surface in message)", () => {
    expect(() =>
      applyEdits("0123456789", [
        { start: 2, end: 6, replacement: "X", rule_id: "rule-a" },
        { start: 4, end: 8, replacement: "Y", rule_id: "rule-b" },
      ]),
    ).toThrow(/overlapping edits.*rule-a.*rule-b|rule-b.*rule-a/);
  });

  it("throws when start > end (degenerate range)", () => {
    expect(() =>
      applyEdits("hello", [{ start: 4, end: 2, replacement: "X" }]),
    ).toThrow(/start.*4.* >.* end.*2/);
  });

  it("throws when end > sourceText.length (out of bounds)", () => {
    expect(() =>
      applyEdits("hello", [{ start: 2, end: 100, replacement: "X" }]),
    ).toThrow(/end.*100.*exceeds sourceText\.length.*5/);
  });

  it("throws when start is negative", () => {
    expect(() =>
      applyEdits("hello", [{ start: -1, end: 2, replacement: "X" }]),
    ).toThrow(/start.*-1.*negative/);
  });

  it("throws when sourceText is empty and edit has end > 0", () => {
    expect(() => applyEdits("", [{ start: 0, end: 1, replacement: "X" }])).toThrow(
      /end.*1.*exceeds sourceText\.length.*0/,
    );
  });
});
