import type { ScanMetadata, ScanResult, WebhookHandler } from "@hookwarden/engine";
import { describe, expect, it } from "vitest";
import { renderInventory } from "../src/render/inventory.js";

const META: ScanMetadata = {
  engine_version: "0.0.1",
  engine_commit_sha: null,
  rule_pack_version: "0.0.1",
  rule_pack_content_hash: "deadbeef",
  scanned_at: "2026-05-03T00:00:00.000Z",
  parse_errors_count: 0,
  parsed_files_count: 1,
  total_files_count: 1,
};

const baseHandler: WebhookHandler = {
  id: "h1",
  framework: "express",
  framework_version: null,
  route_pattern: "/webhooks/stripe",
  http_methods: ["POST"],
  file_path: "src/server.ts",
  location: { line: 10, col: 1, end_line: 12, end_col: 1 },
  handler_function_name: "handleStripe",
  provider: "stripe",
  verification_state: "not-verified",
  evidence: [],
  middleware_chain: [],
  reachable_symbols: [],
  findings_ref: [],
  redacted_snippet: "",
};

function mkResult(inventory: ReadonlyArray<WebhookHandler>): ScanResult {
  return { findings: [], inventory, metadata: META };
}

describe("renderInventory (DISCOVERY-01)", () => {
  it("returns the empty-inventory message listing all 7 supported frameworks", () => {
    const out = renderInventory(mkResult([]), { useAnsi: false, cwd: "/tmp" });
    expect(out).toContain("No webhook handlers detected");
    expect(out).toContain("Express");
    expect(out).toContain("Hono");
    expect(out).toContain("Fastify");
    expect(out).toContain("Next.js");
    expect(out).toContain("Flask");
    expect(out).toContain("FastAPI");
    expect(out).toContain("Django");
  });

  it("renders all 5 columns for one handler", () => {
    const out = renderInventory(mkResult([baseHandler]), { useAnsi: false, cwd: "/tmp" });
    expect(out).toContain("framework");
    expect(out).toContain("route_pattern");
    expect(out).toContain("provider");
    expect(out).toContain("state");
    expect(out).toContain("file:line");
    expect(out).toContain("express");
    expect(out).toContain("/webhooks/stripe");
    expect(out).toContain("stripe");
    expect(out).toContain("[not-verified]");
    expect(out).toContain("src/server.ts:10");
  });

  it("appends framework_version via @ when non-null", () => {
    const handler: WebhookHandler = { ...baseHandler, framework_version: "4" };
    const out = renderInventory(mkResult([handler]), { useAnsi: false, cwd: "/tmp" });
    expect(out).toContain("express@4");
  });

  it("sorts handlers deterministically by file_path then route_pattern", () => {
    const handlers: WebhookHandler[] = [
      {
        ...baseHandler,
        id: "b",
        file_path: "b/srv.ts",
        route_pattern: "/webhooks/github",
      },
      {
        ...baseHandler,
        id: "c",
        file_path: "a/srv.ts",
        route_pattern: "/webhooks/zeta",
      },
      {
        ...baseHandler,
        id: "a",
        file_path: "a/srv.ts",
        route_pattern: "/webhooks/alpha",
      },
    ];
    const out = renderInventory(mkResult(handlers), { useAnsi: false, cwd: "/tmp" });
    const alphaIdx = out.indexOf("/webhooks/alpha");
    const zetaIdx = out.indexOf("/webhooks/zeta");
    const githubIdx = out.indexOf("/webhooks/github");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(zetaIdx);
    expect(zetaIdx).toBeLessThan(githubIdx);
  });

  it("emits OSC-8 file:// hyperlink when useAnsi is true", () => {
    const out = renderInventory(mkResult([baseHandler]), {
      useAnsi: true,
      cwd: "/tmp",
    });
    expect(out).toContain("]8;;file:///tmp/src/server.ts:10:1");
  });

  it("does not emit OSC-8 sequences when useAnsi is false", () => {
    const out = renderInventory(mkResult([baseHandler]), {
      useAnsi: false,
      cwd: "/tmp",
    });
    expect(out).not.toContain("]8;;");
  });

  it("renders [verified] / [not-verified] / [manual-review] state column for the three-state moat", () => {
    const handlers: WebhookHandler[] = [
      { ...baseHandler, id: "a", file_path: "a.ts", verification_state: "verified" },
      { ...baseHandler, id: "b", file_path: "b.ts", verification_state: "not-verified" },
      { ...baseHandler, id: "c", file_path: "c.ts", verification_state: "manual-review" },
    ];
    const out = renderInventory(mkResult(handlers), { useAnsi: false, cwd: "/tmp" });
    expect(out).toContain("[verified]");
    expect(out).toContain("[not-verified]");
    expect(out).toContain("[manual-review]");
  });

  it("bolds the header with a real ESC sequence when useAnsi is true (no literal [1m leak)", () => {
    // Regression: BOLD_ON/BOLD_OFF were "[1m"/"[0m" (missing the \x1b), so color-mode output
    // printed a literal `[1mframework … file:line[0m` header instead of bolding it.
    const out = renderInventory(mkResult([baseHandler]), { useAnsi: true, cwd: "/tmp" });
    expect(out).toContain("\x1b[1m");
    expect(out).toContain("\x1b[0m");
    // The "[1mframework" header text must always be preceded by a real ESC byte — never bare.
    const headerIdx = out.indexOf("[1mframework");
    expect(headerIdx).toBeGreaterThan(0);
    expect(out[headerIdx - 1]).toBe("\x1b");
  });

  it("snapshot — empty inventory", () => {
    const out = renderInventory(mkResult([]), { useAnsi: false, cwd: "/tmp" });
    expect(out).toMatchSnapshot();
  });

  it("snapshot — populated inventory (3 handlers across 3 files)", () => {
    const handlers: WebhookHandler[] = [
      {
        ...baseHandler,
        id: "h1",
        file_path: "src/api/stripe.ts",
        route_pattern: "/webhooks/stripe",
        provider: "stripe",
        framework: "express",
        framework_version: "4",
        verification_state: "not-verified",
        location: { line: 12, col: 1, end_line: 30, end_col: 1 },
      },
      {
        ...baseHandler,
        id: "h2",
        file_path: "src/api/github.ts",
        route_pattern: "/webhooks/github",
        provider: "github",
        framework: "hono",
        framework_version: null,
        verification_state: "verified",
        location: { line: 8, col: 1, end_line: 24, end_col: 1 },
      },
      {
        ...baseHandler,
        id: "h3",
        file_path: "app/handlers.py",
        route_pattern: "/hooks",
        provider: "unknown",
        framework: "flask",
        framework_version: null,
        verification_state: "manual-review",
        location: { line: 42, col: 1, end_line: 60, end_col: 1 },
      },
    ];
    const out = renderInventory(mkResult(handlers), { useAnsi: false, cwd: "/tmp" });
    expect(out).toMatchSnapshot();
  });
});
