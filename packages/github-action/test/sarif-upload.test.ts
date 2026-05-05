import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadSarif: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  warning: mocks.warning,
  info: mocks.info,
}));

vi.mock("@actions/github", () => ({
  context: {
    eventName: "pull_request",
    sha: "abc123",
    ref: "refs/heads/feature",
    repo: { owner: "Hookwarden", repo: "hookwarden" },
    payload: {
      pull_request: { number: 42, head: { sha: "def456" } },
    },
  },
  getOctokit: () => ({
    rest: {
      codeScanning: { uploadSarif: mocks.uploadSarif },
    },
  }),
}));

import { uploadSarif } from "../src/sarif-upload.js";

let tmp: string;
let savedToken: string | undefined;

const SAMPLE_SARIF = JSON.stringify({ version: "2.1.0", runs: [] });

beforeEach(async () => {
  vi.clearAllMocks();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sarif-upload-"));
  savedToken = process.env["GITHUB_TOKEN"];
  process.env["GITHUB_TOKEN"] = "ghs_test_token";
  mocks.uploadSarif.mockResolvedValue({ data: { id: "upload-id-1" } });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  if (savedToken === undefined) delete process.env["GITHUB_TOKEN"];
  else process.env["GITHUB_TOKEN"] = savedToken;
});

async function writeSarif(): Promise<string> {
  const p = path.join(tmp, "hookwarden.sarif");
  await fs.writeFile(p, SAMPLE_SARIF);
  return p;
}

describe("uploadSarif", () => {
  it("skips with warning on fork PR (T-05-04-01)", async () => {
    const sarifPath = await writeSarif();
    await uploadSarif({ sarifPath, isFork: true });
    expect(mocks.uploadSarif).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("fork PRs"));
  });

  it("skips with warning when SARIF file is missing", async () => {
    await uploadSarif({
      sarifPath: path.join(tmp, "does-not-exist.sarif"),
      isFork: false,
    });
    expect(mocks.uploadSarif).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("file not found"));
  });

  it("skips with warning when GITHUB_TOKEN is missing", async () => {
    delete process.env["GITHUB_TOKEN"];
    const sarifPath = await writeSarif();
    await uploadSarif({ sarifPath, isFork: false });
    expect(mocks.uploadSarif).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN"));
  });

  it("happy path: uploads gzip+base64 SARIF with PR head sha + ref", async () => {
    const sarifPath = await writeSarif();
    await uploadSarif({ sarifPath, isFork: false });

    expect(mocks.uploadSarif).toHaveBeenCalledTimes(1);
    expect(mocks.uploadSarif).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Hookwarden",
        repo: "hookwarden",
        commit_sha: "def456",
        ref: "refs/pull/42/head",
        tool_name: "hookwarden",
        sarif: expect.any(String),
      }),
    );
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("upload-id-1"));
  });

  it("catches 403 and emits security-events warning (does NOT throw)", async () => {
    const sarifPath = await writeSarif();
    mocks.uploadSarif.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(uploadSarif({ sarifPath, isFork: false })).resolves.toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("security-events"));
  });

  it("catches non-403 errors and emits SARIF upload failed warning (does NOT throw)", async () => {
    const sarifPath = await writeSarif();
    mocks.uploadSarif.mockRejectedValue(new Error("boom"));
    await expect(uploadSarif({ sarifPath, isFork: false })).resolves.toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledWith(
      expect.stringContaining("SARIF upload failed: boom"),
    );
  });
});
