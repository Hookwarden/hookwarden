import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CLEAN_BODY, STICKY_MARKER } from "@hookwarden/pr-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanJsonEnvelope } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  getInput: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  uploadSarif: vi.fn(),
  context: {} as Record<string, unknown>,
}));

vi.mock("@actions/exec", () => ({ exec: mocks.exec }));

vi.mock("@actions/core", () => ({
  getInput: mocks.getInput,
  setOutput: mocks.setOutput,
  setFailed: mocks.setFailed,
  warning: mocks.warning,
  info: mocks.info,
}));

vi.mock("@actions/github", () => ({
  get context() {
    return mocks.context;
  },
  getOctokit: () => ({
    rest: {
      issues: {
        listComments: mocks.listComments,
        createComment: mocks.createComment,
        updateComment: mocks.updateComment,
      },
      codeScanning: { uploadSarif: mocks.uploadSarif },
    },
  }),
}));

let tmp: string;
let savedToken: string | undefined;
let savedRunnerTemp: string | undefined;
let sampleScan: ScanJsonEnvelope;

beforeEach(async () => {
  vi.clearAllMocks();

  // Default getInput returns
  mocks.getInput.mockImplementation((name: string) => {
    const map: Record<string, string> = {
      "fail-on": "high",
      "config-path": "",
      "working-directory": ".",
    };
    return map[name] ?? "";
  });

  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gha-int-"));
  savedToken = process.env["GITHUB_TOKEN"];
  savedRunnerTemp = process.env["RUNNER_TEMP"];
  process.env["GITHUB_TOKEN"] = "ghs_test";
  process.env["RUNNER_TEMP"] = tmp;

  sampleScan = JSON.parse(
    await fs.readFile(path.join(__dirname, "fixtures/sample-scan.json"), "utf8"),
  ) as ScanJsonEnvelope;

  mocks.listComments.mockResolvedValue({ data: [] });
  mocks.createComment.mockResolvedValue({ data: { id: 1234 } });
  mocks.updateComment.mockResolvedValue({ data: { id: 1234 } });
  mocks.uploadSarif.mockResolvedValue({ data: { id: "upload-id-1" } });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  if (savedToken === undefined) delete process.env["GITHUB_TOKEN"];
  else process.env["GITHUB_TOKEN"] = savedToken;
  if (savedRunnerTemp === undefined) delete process.env["RUNNER_TEMP"];
  else process.env["RUNNER_TEMP"] = savedRunnerTemp;
});

interface ExecOptions {
  readonly listeners?: { stdout?: (b: Buffer) => void };
}

function setExecToReturnEnvelope(envelopes: ScanJsonEnvelope[]): void {
  // exec is called many times: git fetch / git checkout (no stdout payload)
  // and node hookwarden scan (returns envelope or sarif). We return JSON
  // envelopes for `--format json` calls, an empty SARIF stub for `--format sarif`,
  // and exit 0 for everything else (git operations).
  let envelopeIndex = 0;
  mocks.exec.mockImplementation(
    (cmd: string, args: ReadonlyArray<string>, opts: ExecOptions = {}) => {
      const isHookwardenScan = cmd === "node" && args.includes("scan");
      if (!isHookwardenScan) {
        return Promise.resolve(0);
      }
      const isSarif = args.includes("sarif");
      const stdout = isSarif
        ? '{"version":"2.1.0","runs":[]}'
        : JSON.stringify(envelopes[envelopeIndex++ % envelopes.length]);
      opts.listeners?.stdout?.(Buffer.from(stdout, "utf8"));
      return Promise.resolve(0);
    },
  );
}

function setExecToFailWithExitCode(envelope: ScanJsonEnvelope, exitCode: number): void {
  mocks.exec.mockImplementation(
    (cmd: string, args: ReadonlyArray<string>, opts: ExecOptions = {}) => {
      const isHookwardenScan = cmd === "node" && args.includes("scan");
      if (!isHookwardenScan) return Promise.resolve(0);
      const isSarif = args.includes("sarif");
      const stdout = isSarif ? '{"version":"2.1.0","runs":[]}' : JSON.stringify(envelope);
      opts.listeners?.stdout?.(Buffer.from(stdout, "utf8"));
      const isDiffOnly = args.includes("--diff-only");
      // Exit code on the head --diff-only run is what drives ACTION-04.
      // Other invocations (base scan, sarif emission) return 0.
      return Promise.resolve(isDiffOnly ? exitCode : 0);
    },
  );
}

function pushContext(): void {
  mocks.context = {
    eventName: "push",
    sha: "pushsha",
    ref: "refs/heads/main",
    repo: { owner: "Hookwarden", repo: "hookwarden" },
    payload: {},
  };
}

function prContext(opts: { isFork?: boolean; prNumber?: number } = {}): void {
  const headRepo = opts.isFork === true ? "attacker/fork" : "Hookwarden/hookwarden";
  mocks.context = {
    eventName: "pull_request",
    sha: "prsha",
    ref: "refs/pull/7/head",
    repo: { owner: "Hookwarden", repo: "hookwarden" },
    payload: {
      pull_request: {
        number: opts.prNumber ?? 7,
        base: { ref: "main", repo: { full_name: "Hookwarden/hookwarden" } },
        head: { sha: "prheadsha", repo: { full_name: headRepo } },
      },
    },
  };
}

function envelopeWithExtraFinding(base: ScanJsonEnvelope, hash: string): ScanJsonEnvelope {
  const baseFindings = base.scan.findings;
  const extra = {
    finding_id: `stripe/new-finding@${hash}`,
    rule_id: "stripe/new-finding",
    provider: "stripe" as const,
    severity: "critical" as const,
    state: "not-verified" as const,
    file_path: "src/api/new.ts",
    location: { line: 1, col: 1 },
    primary_location_line_hash: hash,
    message: "Brand new webhook handler missing verification",
    redacted_snippet: null,
    suppressed: null,
  };
  return {
    ...base,
    scan: {
      ...base.scan,
      findings: [extra, ...baseFindings],
    },
  };
}

describe("ACTION-01 same-binary invariant", () => {
  it("invokes the bundled hookwarden CLI as a node subprocess", async () => {
    pushContext();
    setExecToReturnEnvelope([sampleScan]);
    const { runActionScan } = await import("../src/scan.js");
    await runActionScan({
      failOn: "high",
      configPath: undefined,
      workingDirectory: ".",
    });
    const scanCalls = mocks.exec.mock.calls.filter(
      ([cmd, args]) => cmd === "node" && (args as string[]).includes("scan"),
    );
    expect(scanCalls.length).toBeGreaterThan(0);
    const [, args] = scanCalls[0];
    expect((args as string[])[0]).toMatch(/hookwarden/);
  });
});

describe("ACTION-02 PR comment behavior", () => {
  it("posts new PR comment when head has new findings (D-84)", async () => {
    prContext();
    const baseEnvelope = sampleScan;
    const headEnvelope = envelopeWithExtraFinding(sampleScan, "newhash000001");
    setExecToReturnEnvelope([baseEnvelope, headEnvelope]);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.createComment).toHaveBeenCalledTimes(1);
    const [{ body }] = mocks.createComment.mock.calls[0] as [{ body: string }];
    expect(body).toContain(STICKY_MARKER);
    expect(body).toContain("stripe/new-finding");
    expect(body).toContain("src/api/new.ts");
  });

  it("silent on clean: no new findings + no prior sticky → no comment write", async () => {
    prContext();
    setExecToReturnEnvelope([sampleScan, sampleScan]);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(mocks.updateComment).not.toHaveBeenCalled();
  });

  it("updates prior sticky to CLEAN_BODY when no new findings + prior present (D-83)", async () => {
    prContext();
    setExecToReturnEnvelope([sampleScan, sampleScan]);
    mocks.listComments.mockResolvedValue({
      data: [
        {
          id: 999,
          body: `${STICKY_MARKER}\nold body`,
          user: { login: "github-actions[bot]" },
        },
      ],
    });

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 999, body: CLEAN_BODY }),
    );
  });
});

describe("ACTION-03 SARIF upload", () => {
  it("uploads SARIF on push event (D-85 full scan + upload)", async () => {
    pushContext();
    setExecToReturnEnvelope([sampleScan]);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.uploadSarif).toHaveBeenCalledTimes(1);
    expect(mocks.uploadSarif).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Hookwarden",
        repo: "hookwarden",
        tool_name: "hookwarden",
      }),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("skips SARIF upload + PR comment on fork PR (T-05-04-01 / T-05-03-04)", async () => {
    prContext({ isFork: true });
    setExecToReturnEnvelope([sampleScan, sampleScan]);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.uploadSarif).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
    const fork = mocks.warning.mock.calls
      .flat()
      .some((m) => typeof m === "string" && m.toLowerCase().includes("fork"));
    expect(fork).toBe(true);
  });
});

describe("ACTION-04 threshold → exit code", () => {
  it("exit code 1 (findings ≥ fail-on) → core.setFailed", async () => {
    prContext();
    const headEnvelope = envelopeWithExtraFinding(sampleScan, "fail00001");
    setExecToFailWithExitCode(headEnvelope, 1);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.setFailed).toHaveBeenCalledTimes(1);
    expect(mocks.setFailed.mock.calls[0]?.[0]).toMatch(/new finding/i);
  });

  it("exit code 0 (no findings ≥ fail-on) → no core.setFailed", async () => {
    pushContext();
    setExecToReturnEnvelope([sampleScan]);

    const { run } = await import("../src/index.js");
    await run();

    expect(mocks.setFailed).not.toHaveBeenCalled();
  });
});

describe("Output setting (D-88 — all 4 outputs)", () => {
  it("sets findings-count, new-findings-count, findings-by-severity, sarif-path", async () => {
    pushContext();
    setExecToReturnEnvelope([sampleScan]);

    const { run } = await import("../src/index.js");
    await run();

    const outputNames = mocks.setOutput.mock.calls.map((c) => c[0]);
    expect(outputNames).toEqual(
      expect.arrayContaining([
        "findings-count",
        "new-findings-count",
        "findings-by-severity",
        "sarif-path",
      ]),
    );
    // findings-count for the fixture's active counts:
    // critical 1 + high 1 + medium 1 + low 1 + info 2 = 6
    const findingsCountCall = mocks.setOutput.mock.calls.find((c) => c[0] === "findings-count");
    expect(findingsCountCall?.[1]).toBe(6);
    // non-PR event → new-findings-count = 0
    const newFindingsCall = mocks.setOutput.mock.calls.find((c) => c[0] === "new-findings-count");
    expect(newFindingsCall?.[1]).toBe(0);
  });
});
