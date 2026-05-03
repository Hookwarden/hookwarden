import { describe, expect, it, vi } from "vitest";
import { main } from "../src/index.js";

describe("CLI main(argv) shape (CLI-01)", () => {
  it("no-arg invocation prints help and returns 0 (D-47)", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
      return true;
    });
    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(writes.join("")).toContain("hookwarden");
      expect(writes.join("")).toContain("scan");
      expect(writes.join("")).toContain("inventory");
    } finally {
      spy.mockRestore();
    }
  });

  it("--version returns 0 and prints the version", async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
      return true;
    });
    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(writes.join("")).toContain("0.0.1");
    } finally {
      spy.mockRestore();
    }
  });

  it("-V short flag returns 0", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await main(["-V"]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("--help returns 0", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await main(["--help"]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("unknown subcommand returns 2 (D-49)", async () => {
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      errs.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
      return true;
    });
    try {
      const code = await main(["wat"]);
      expect(code).toBe(2);
      expect(errs.join("")).toContain("unknown command");
    } finally {
      spy.mockRestore();
    }
  });

  it("scan --help returns 0 without invoking pipeline", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await main(["scan", "--help"]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
