import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { chiGinEchoGoAdapter } from "../../src/adapters/chi-gin-echo-go.js";
import { ALL_ADAPTERS } from "../../src/adapters/index.js";
import { netHttpGoAdapter } from "../../src/adapters/net-http-go.js";
import { parseGo } from "../../src/parsers/go.js";
import { type GoRuntime, initGoRuntime } from "../../src/parsers/go-loader.js";
import type { ParsedFile } from "../../src/types/project-model.js";
import { resolveGoWasmPath } from "../wasm.js";

let runtime: GoRuntime;

beforeAll(async () => {
  runtime = await initGoRuntime({ wasmBytes: new Uint8Array(readFileSync(resolveGoWasmPath())) });
}, 30_000);

async function parse(file_path: string, source_text: string): Promise<ParsedFile> {
  return await parseGo({ file_path, source_text }, runtime);
}

describe("netHttpGoAdapter — heuristic net/http webhook detection", () => {
  it("detects a handler with io.ReadAll + hmac + signature header", async () => {
    const file = await parse(
      "webhooks/stripe.go",
      'package webhooks\n\nimport (\n\t"crypto/hmac"\n\t"crypto/sha256"\n\t"io"\n\t"net/http"\n)\n\n' +
        "func StripeWebhook(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("Stripe-Signature")\n' +
        "\tmac := hmac.New(sha256.New, []byte(secret))\n" +
        "\tmac.Write(body)\n" +
        "\t_ = sig\n" +
        "}\n",
    );
    const handlers = netHttpGoAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("net-http-go");
    expect(handlers[0]?.route_pattern).toBe("/stripe");
    expect(handlers[0]?.handler_function_name).toBe("StripeWebhook");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
  });

  it("does NOT emit on a handler-signature-only file (over-emission guard, Pitfall 6)", async () => {
    const file = await parse(
      "handlers/ping.go",
      'package handlers\n\nimport "net/http"\n\n' +
        "func Ping(w http.ResponseWriter, r *http.Request) {\n" +
        '\tw.Write([]byte("pong"))\n' +
        "}\n",
    );
    expect(netHttpGoAdapter(file, [file])).toHaveLength(0);
  });

  it("yields to the framework adapter when chi/gin/echo is imported", async () => {
    const file = await parse(
      "webhooks/chi.go",
      'package webhooks\n\nimport (\n\t"io"\n\t"net/http"\n\t"github.com/go-chi/chi/v5"\n)\n\n' +
        "func handler(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        "\t_ = body\n" +
        "}\n",
    );
    expect(netHttpGoAdapter(file, [file])).toHaveLength(0);
  });
});

describe("chiGinEchoGoAdapter — import-gated router detection", () => {
  it("detects a chi r.Post route and resolves the named same-file handler", async () => {
    const file = await parse(
      "routes/chi.go",
      'package routes\n\nimport (\n\t"crypto/hmac"\n\t"io"\n\t"net/http"\n\t"github.com/go-chi/chi/v5"\n)\n\n' +
        "func Register(r chi.Router) {\n" +
        '\tr.Post("/webhooks/stripe", stripeHandler)\n' +
        "}\n\n" +
        "func stripeHandler(w http.ResponseWriter, r *http.Request) {\n" +
        "\tbody, _ := io.ReadAll(r.Body)\n" +
        '\tsig := r.Header.Get("Stripe-Signature")\n' +
        "\t_ = hmac.Equal\n" +
        "\t_ = body\n" +
        "\t_ = sig\n" +
        "}\n",
    );
    const handlers = chiGinEchoGoAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("chi");
    expect(handlers[0]?.route_pattern).toBe("/webhooks/stripe");
    expect(handlers[0]?.http_methods).toEqual(["POST"]);
    // Resolved to the named function declaration's body, not the bare identifier.
    expect(handlers[0]?.handler_function_name).toBe("stripeHandler");
    const slice = file.source_text.slice(
      handlers[0]?.handler_source_start ?? 0,
      handlers[0]?.handler_source_end ?? 0,
    );
    expect(slice).toContain("io.ReadAll");
  });

  it("detects a gin r.POST route with an inline func_literal", async () => {
    const file = await parse(
      "routes/gin.go",
      'package routes\n\nimport (\n\t"io"\n\t"github.com/gin-gonic/gin"\n)\n\n' +
        "func Register(r *gin.Engine) {\n" +
        '\tr.POST("/hooks/x", func(c *gin.Context) {\n' +
        "\t\tbody, _ := io.ReadAll(c.Request.Body)\n" +
        "\t\t_ = body\n" +
        "\t})\n" +
        "}\n",
    );
    const handlers = chiGinEchoGoAdapter(file, [file]);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.framework).toBe("gin");
    expect(handlers[0]?.route_pattern).toBe("/hooks/x");
  });

  it("does NOT fire without a chi/gin/echo import", async () => {
    const file = await parse(
      "routes/plain.go",
      'package routes\n\nfunc Register(r Router) {\n\tr.Post("/x", h)\n}\n',
    );
    expect(chiGinEchoGoAdapter(file, [file])).toHaveLength(0);
  });
});

describe("ALL_ADAPTERS registration order", () => {
  it("registers chiGinEchoGoAdapter before netHttpGoAdapter", () => {
    const chiIdx = ALL_ADAPTERS.indexOf(chiGinEchoGoAdapter);
    const netIdx = ALL_ADAPTERS.indexOf(netHttpGoAdapter);
    expect(chiIdx).toBeGreaterThanOrEqual(0);
    expect(netIdx).toBeGreaterThanOrEqual(0);
    expect(chiIdx).toBeLessThan(netIdx);
  });
});
