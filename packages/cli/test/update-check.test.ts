import { describe, expect, it, vi } from "vitest";
import { maybeRenderUpdateBanner, runUpdateCheck } from "../src/update-check.js";

/** Test-friendly write-capturing stream. */
function makeStream(isTTY = true): {
  isTTY: boolean;
  writes: string[];
  write: (s: string) => boolean;
} {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(s: string): boolean {
      writes.push(s);
      return true;
    },
  };
}

/** Build a fake UpdateNotifier-like instance for banner-render tests. */
function fakeInstance(update: { current: string; latest: string; type?: string } | undefined) {
  return { update } as unknown as ReturnType<typeof runUpdateCheck>;
}

describe("runUpdateCheck", () => {
  it("returns null when disabled — no notifier created", () => {
    const factory = vi.fn();
    const result = runUpdateCheck({
      pkg: { name: "hookwarden", version: "0.7.0" },
      notifierFactory: factory as never,
      disabled: true,
    });
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it("calls the notifier factory with pkg name + version + 24h interval (default)", () => {
    const fakeNotifier = { update: undefined } as never;
    const factory = vi.fn().mockReturnValue(fakeNotifier);
    runUpdateCheck({
      pkg: { name: "hookwarden", version: "0.7.0" },
      notifierFactory: factory as never,
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      pkg: { name: "hookwarden", version: "0.7.0" },
      updateCheckInterval: 1000 * 60 * 60 * 24,
      shouldNotifyInNpmScript: false,
    });
  });

  it("honors a custom updateCheckInterval override", () => {
    const factory = vi.fn().mockReturnValue({ update: undefined } as never);
    runUpdateCheck({
      pkg: { name: "hookwarden", version: "0.7.0" },
      notifierFactory: factory as never,
      updateCheckInterval: 60_000,
    });
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ updateCheckInterval: 60_000 });
  });
});

describe("maybeRenderUpdateBanner", () => {
  it("no banner when instance is null (check disabled)", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(null, { useAnsi: false, stream });
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("no banner when notifier.update is undefined (fetch hasn't returned yet)", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(fakeInstance(undefined), { useAnsi: false, stream });
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("no banner when current === latest (no upgrade available)", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(
      fakeInstance({ current: "0.7.0", latest: "0.7.0", type: "latest" }),
      { useAnsi: false, stream },
    );
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("no banner when format is 'json' (machine-consumed output)", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(
      fakeInstance({ current: "0.7.0", latest: "0.7.3", type: "patch" }),
      { useAnsi: false, format: "json", stream },
    );
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("no banner when format is 'sarif' (machine-consumed output)", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(
      fakeInstance({ current: "0.7.0", latest: "0.7.3", type: "patch" }),
      { useAnsi: false, format: "sarif", stream },
    );
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("no banner when stderr is not a TTY (piped / redirected / captured)", () => {
    const stream = makeStream(false);
    const printed = maybeRenderUpdateBanner(
      fakeInstance({ current: "0.7.0", latest: "0.7.3", type: "patch" }),
      { useAnsi: false, stream },
    );
    expect(printed).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it("renders banner with current → latest + bump-type tag when all gates pass", () => {
    const stream = makeStream(true);
    const printed = maybeRenderUpdateBanner(
      fakeInstance({ current: "0.7.0", latest: "0.7.3", type: "patch" }),
      { useAnsi: false, stream },
    );
    expect(printed).toBe(true);
    const joined = stream.writes.join("");
    expect(joined).toContain("0.7.0");
    expect(joined).toContain("0.7.3");
    expect(joined).toContain("(patch)");
    expect(joined).toContain("npm i -g hookwarden@latest");
  });

  it("omits the bump-type tag when notifier doesn't supply one", () => {
    const stream = makeStream(true);
    maybeRenderUpdateBanner(fakeInstance({ current: "0.7.0", latest: "0.7.3" }), {
      useAnsi: false,
      stream,
    });
    const joined = stream.writes.join("");
    expect(joined).toContain("0.7.0");
    expect(joined).toContain("0.7.3");
    expect(joined).not.toContain("()"); // no empty tag artifact
  });

  it("handles minor/major bump-type values verbatim (no normalization)", () => {
    for (const type of ["minor", "major"] as const) {
      const stream = makeStream(true);
      maybeRenderUpdateBanner(fakeInstance({ current: "0.7.0", latest: "0.8.0", type }), {
        useAnsi: false,
        stream,
      });
      expect(stream.writes.join("")).toContain(`(${type})`);
    }
  });
});
