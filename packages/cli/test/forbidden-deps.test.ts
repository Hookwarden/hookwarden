// CLI-09 — guards the deny-list against silent regression.
import { describe, expect, it } from "vitest";
import {
  buildCategoryRegexes,
  buildForbiddenImportRegex,
  FORBIDDEN_ANALYTICS_SDK_PATTERNS,
  FORBIDDEN_HTTP_CLIENTS,
  FORBIDDEN_NETWORK_BUILTIN,
  isForbiddenImport,
} from "../scripts/forbidden-deps.js";

describe("forbidden-deps deny-list (CLI-09 + Phase 4 success criterion 6)", () => {
  it("FORBIDDEN_NETWORK_BUILTIN includes http and https", () => {
    expect(FORBIDDEN_NETWORK_BUILTIN).toContain("http");
    expect(FORBIDDEN_NETWORK_BUILTIN).toContain("https");
  });

  it("FORBIDDEN_HTTP_CLIENTS includes ROADMAP-named clients", () => {
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("node-fetch");
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("axios");
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("got");
  });

  it("FORBIDDEN_HTTP_CLIENTS includes Phase 4 additions", () => {
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("undici");
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("phin");
    expect(FORBIDDEN_HTTP_CLIENTS).toContain("superagent");
  });

  it("analytics SDK patterns catch typical names", () => {
    const samples = ["mixpanel", "posthog-node", "@segment/analytics-node", "@datadog/browser-rum"];
    for (const s of samples) {
      expect(FORBIDDEN_ANALYTICS_SDK_PATTERNS.some((r) => r.test(s))).toBe(true);
    }
  });

  it("every analytics pattern is a real RegExp", () => {
    for (const r of FORBIDDEN_ANALYTICS_SDK_PATTERNS) {
      expect(r).toBeInstanceOf(RegExp);
    }
  });

  it("isForbiddenImport returns true for every list entry", () => {
    for (const s of FORBIDDEN_NETWORK_BUILTIN) expect(isForbiddenImport(s)).toBe(true);
    for (const s of FORBIDDEN_HTTP_CLIENTS) expect(isForbiddenImport(s)).toBe(true);
  });

  it("isForbiddenImport accepts node: prefix on builtins", () => {
    expect(isForbiddenImport("node:http")).toBe(true);
    expect(isForbiddenImport("node:https")).toBe(true);
  });

  it("isForbiddenImport returns false for known-safe specifiers", () => {
    const safe = [
      "@hookwarden/engine",
      "node:path",
      "js-yaml",
      "picomatch",
      "ignore",
      "@babel/parser",
      "web-tree-sitter",
      "ajv",
    ];
    for (const s of safe) expect(isForbiddenImport(s)).toBe(false);
  });

  it("buildForbiddenImportRegex is deterministic", () => {
    const r1 = buildForbiddenImportRegex();
    const r2 = buildForbiddenImportRegex();
    expect(r1.source).toBe(r2.source);
  });

  it("buildForbiddenImportRegex catches the three import shapes for forbidden specifiers", () => {
    const r = buildForbiddenImportRegex();
    expect(`import x from "axios";`.match(r)).not.toBeNull();
    expect(`require("node-fetch")`.match(r)).not.toBeNull();
    expect(`import "@sentry/node";`.match(r)).not.toBeNull();
    expect(`import x from "@hookwarden/engine";`.match(r)).toBeNull();
  });

  it("buildCategoryRegexes returns category-tagged patterns matching their kind", () => {
    const cats = buildCategoryRegexes();
    const byCat = new Map(cats.map((c) => [c.category, c.pattern]));
    expect(byCat.get("network-builtin")?.test(`import "node:http";`)).toBe(true);
    expect(byCat.get("network-http-client")?.test(`import x from "axios";`)).toBe(true);
    expect(byCat.get("analytics-sdk")?.test(`import "@sentry/node";`)).toBe(true);
    // Cross-category negative: http-client regex should NOT match a sentry import.
    expect(byCat.get("network-http-client")?.test(`import "@sentry/node";`)).toBe(false);
  });
});
