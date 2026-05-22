import type { ParsedFile } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { extractInlineSuppressions } from "../src/suppress/inline-comments.js";

interface BabelCommentFixture {
  readonly value: string;
  readonly line: number;
}

function mockJsFile(
  file_path: string,
  comments: ReadonlyArray<BabelCommentFixture>,
  source = "",
): ParsedFile {
  return {
    file_path,
    language: "javascript",
    dialect: "babel",
    source_text: source,
    raw_ast: {
      comments: comments.map((c) => ({ value: c.value, loc: { start: { line: c.line } } })),
    },
    imports: [],
    parse_error: null,
  } as unknown as ParsedFile;
}

interface PyCommentFixture {
  readonly text: string;
  readonly row: number;
}

function mockPyFile(
  file_path: string,
  commentNodes: ReadonlyArray<PyCommentFixture>,
  source = "",
): ParsedFile {
  const children = commentNodes.map((c) => ({
    type: "comment",
    text: c.text,
    startPosition: { row: c.row },
    childCount: 0,
    child: () => null,
  }));
  const rootNode = {
    type: "module",
    startPosition: { row: 0 },
    childCount: children.length,
    child: (i: number) => children[i] ?? null,
    text: "",
  };
  return {
    file_path,
    language: "python",
    dialect: "tree-sitter-python",
    source_text: source,
    raw_ast: { rootNode },
    imports: [],
    parse_error: null,
  } as unknown as ParsedFile;
}

interface PhpCommentFixture {
  readonly text: string;
  readonly row: number;
}

function mockPhpFile(
  file_path: string,
  commentNodes: ReadonlyArray<PhpCommentFixture>,
  source = "",
): ParsedFile {
  const children = commentNodes.map((c) => ({
    type: "comment",
    text: c.text,
    startPosition: { row: c.row },
    childCount: 0,
    child: () => null,
  }));
  const rootNode = {
    type: "program",
    startPosition: { row: 0 },
    childCount: children.length,
    child: (i: number) => children[i] ?? null,
    text: "",
  };
  return {
    file_path,
    language: "php",
    dialect: "tree-sitter-php",
    source_text: source,
    raw_ast: { rootNode },
    imports: [],
    parse_error: null,
  } as unknown as ParsedFile;
}

describe("extractInlineSuppressions", () => {
  it("disable-next-line targets the next line", () => {
    const file = mockJsFile("a.ts", [
      { value: " hookwarden-disable-next-line stripe/missing-verification", line: 10 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries).toHaveLength(1);
    const e = result.entries[0];
    expect(e?.line).toBe(11);
    expect(e?.rule_ids).toEqual(["stripe/missing-verification"]);
    expect(e?.form).toBe("disable-next-line");
  });

  it("disable-line targets the same line as the comment", () => {
    const file = mockJsFile("a.ts", [
      { value: " hookwarden-disable-line stripe/missing-verification", line: 10 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries[0]?.line).toBe(10);
    expect(result.entries[0]?.form).toBe("disable-line");
  });

  it("disable/enable block covers every line in between", () => {
    const file = mockJsFile("a.ts", [
      { value: " hookwarden-disable foo/bar", line: 5 },
      { value: " hookwarden-enable", line: 12 },
    ]);
    const result = extractInlineSuppressions([file]);
    const lineMap = result.perLine.get("a.ts");
    expect(lineMap?.get(5)?.has("foo/bar")).toBe(true);
    expect(lineMap?.get(8)?.has("foo/bar")).toBe(true);
    expect(lineMap?.get(12)?.has("foo/bar")).toBe(true);
    expect(result.entries[0]?.form).toBe("block");
  });

  it("Python `#` comments use the same syntax", () => {
    const file = mockPyFile("a.py", [
      { text: "# hookwarden-disable-next-line github/missing-verification", row: 21 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries[0]?.line).toBe(23);
  });

  it("PHP `//` comments parse via the tree-sitter branch", () => {
    const file = mockPhpFile("webhook.php", [
      { text: "// hookwarden-disable-next-line stripe/timing-unsafe-comparison", row: 14 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.line).toBe(16);
    expect(result.entries[0]?.rule_ids).toEqual(["stripe/timing-unsafe-comparison"]);
    expect(result.entries[0]?.form).toBe("disable-next-line");
  });

  it("PHP `#` comments parse via the tree-sitter branch", () => {
    const file = mockPhpFile("webhook.php", [
      { text: "# hookwarden-disable-next-line stripe/timing-unsafe-comparison", row: 14 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.line).toBe(16);
    expect(result.entries[0]?.rule_ids).toEqual(["stripe/timing-unsafe-comparison"]);
    expect(result.entries[0]?.form).toBe("disable-next-line");
  });

  it("multi-rule comma-separated rule ids", () => {
    const file = mockJsFile("a.ts", [
      { value: " hookwarden-disable-next-line a/b, c/d, e/f", line: 1 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries[0]?.rule_ids).toEqual(["a/b", "c/d", "e/f"]);
  });

  it("rejects comments without a rule-id (D-61: no silent global suppression)", () => {
    const file = mockJsFile("a.ts", [{ value: " hookwarden-disable-next-line", line: 1 }]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries).toHaveLength(0);
  });

  it("ignores comments that do not match the disable/enable syntax", () => {
    const file = mockJsFile("a.ts", [{ value: " disable next line foo", line: 1 }]);
    const result = extractInlineSuppressions([file]);
    expect(result.entries).toHaveLength(0);
  });

  it("perLine map exposes line + rule lookups", () => {
    const file = mockJsFile("a.ts", [
      { value: " hookwarden-disable-next-line stripe/missing-verification", line: 10 },
    ]);
    const result = extractInlineSuppressions([file]);
    expect(result.perLine.get("a.ts")?.get(11)?.has("stripe/missing-verification")).toBe(true);
  });
});
