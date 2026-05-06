import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests import the SUT lazily inside each test (after mocks are installed) so
// the loader module re-evaluates the runtime detection against the mocked
// globals. Top-level `import` would freeze the detection at module-load time.

const ORIGINAL_BUN = (globalThis as { Bun?: unknown }).Bun;
const ORIGINAL_PROCESS_VERSIONS_BUN = process.versions["bun"];

function setBunRuntime(): void {
  (globalThis as { Bun?: unknown }).Bun = {
    file: (_path: string) => ({
      bytes: async () => new Uint8Array(),
    }),
  };
  Object.defineProperty(process.versions, "bun", {
    configurable: true,
    value: "1.1.34",
  });
}

function unsetBunRuntime(): void {
  delete (globalThis as { Bun?: unknown }).Bun;
  Object.defineProperty(process.versions, "bun", {
    configurable: true,
    value: undefined,
  });
}

describe("loadPythonWasmBytes — runtime detection", () => {
  beforeEach(() => {
    vi.resetModules();
    unsetBunRuntime();
  });

  afterEach(() => {
    if (ORIGINAL_BUN !== undefined) {
      (globalThis as { Bun?: unknown }).Bun = ORIGINAL_BUN;
    } else {
      delete (globalThis as { Bun?: unknown }).Bun;
    }
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: ORIGINAL_PROCESS_VERSIONS_BUN,
    });
  });

  it("Node branch: reads tree-sitter-python.wasm from disk and returns a non-empty Uint8Array", async () => {
    expect((globalThis as { Bun?: unknown }).Bun).toBeUndefined();
    expect(process.versions["bun"]).toBeUndefined();

    const { loadPythonWasmBytes } = await import("../src/wasm/loader.js");
    const bytes = await loadPythonWasmBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("Bun branch: delegates to bun-asset.loadBunEmbeddedWasm()", async () => {
    const fakeBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    setBunRuntime();
    vi.doMock("../src/wasm/bun-asset.js", () => ({
      loadBunEmbeddedWasm: async () => fakeBytes,
    }));

    const { loadPythonWasmBytes } = await import("../src/wasm/loader.js");
    const bytes = await loadPythonWasmBytes();
    expect(bytes).toEqual(fakeBytes);
  });

  it("Defensive detection: globalThis.Bun present but process.versions.bun undefined → Node branch", async () => {
    (globalThis as { Bun?: unknown }).Bun = {
      file: () => ({ bytes: async () => new Uint8Array() }),
    };
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: undefined,
    });

    const { loadPythonWasmBytes } = await import("../src/wasm/loader.js");
    const bytes = await loadPythonWasmBytes();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("Defensive detection: process.versions.bun set but globalThis.Bun undefined → Node branch", async () => {
    delete (globalThis as { Bun?: unknown }).Bun;
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.1.34",
    });

    const { loadPythonWasmBytes } = await import("../src/wasm/loader.js");
    const bytes = await loadPythonWasmBytes();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("Node branch error propagation: fs.readFile failure surfaces to caller", async () => {
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        promises: {
          ...actual.promises,
          readFile: vi.fn(async () => {
            const e = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
            e.code = "ENOENT";
            throw e;
          }),
        },
      };
    });

    const { loadPythonWasmBytes } = await import("../src/wasm/loader.js");
    await expect(loadPythonWasmBytes()).rejects.toThrow(/ENOENT/);
  });
});
