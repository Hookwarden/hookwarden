// SARIF upload to GitHub Code Scanning.
//
// ACTION-03: POST /repos/{owner}/{repo}/code-scanning/sarifs with gzip+base64 body.
// ACTION-01 + Phase 4 D-60: the Action does NOT regenerate SARIF — it uploads the
// file the bundled CLI already wrote. The CLI's SARIF renderer (Plan 04-08) is the
// byte-stable, OASIS-validated source of truth.
//
// D-89 explicit non-permission: this module does NOT need 'checks: write'. The
// failed-check semantics flow from the CLI's exit code 1 through core.setFailed
// (Plan 02 src/index.ts), not through this upload's success/failure.
//
// T-05-04-01: fork-PR EoP defense — short-circuit before the Octokit call. Defense
// in depth alongside the index.ts call-site guard.

import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as core from "@actions/core";
import * as github from "@actions/github";

export interface UploadSarifInput {
  readonly sarifPath: string;
  readonly isFork: boolean;
}

interface PullRequestContext {
  readonly number: number;
  readonly head: { readonly sha: string };
}

export async function uploadSarif(input: UploadSarifInput): Promise<void> {
  if (input.isFork) {
    core.warning("Skipping SARIF upload: security-events: write not available on fork PRs");
    return;
  }

  if (!existsSync(input.sarifPath)) {
    core.warning(`Skipping SARIF upload: file not found at ${input.sarifPath}`);
    return;
  }

  const token = process.env["GITHUB_TOKEN"];
  if (typeof token !== "string" || token.length === 0) {
    core.warning(
      "Skipping SARIF upload: GITHUB_TOKEN not available (require security-events: write in workflow permissions)",
    );
    return;
  }

  // T-05-04-03: SARIF written by trusted CLI to RUNNER_TEMP a few hundred ms ago;
  // no untrusted writers on the runner between write and read.
  const sarifJson = readFileSync(input.sarifPath, "utf8");
  const compressed = gzipSync(Buffer.from(sarifJson));
  const sarif = compressed.toString("base64");

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const pr = github.context.payload["pull_request"] as PullRequestContext | undefined;
  const commitSha = pr?.head.sha ?? github.context.sha;
  const ref =
    pr !== undefined && typeof pr.number === "number"
      ? `refs/pull/${pr.number}/head`
      : github.context.ref;

  try {
    const { data } = await octokit.rest.codeScanning.uploadSarif({
      owner,
      repo,
      commit_sha: commitSha,
      ref,
      sarif,
      tool_name: "hookwarden",
    });
    const id = (data as { id?: string }).id ?? "<no-id>";
    core.info(`SARIF upload accepted: ${id}`);
  } catch (err) {
    // Never throw — Plan 02's index.ts already drives ACTION-04 from the scan exit
    // code. Upload failure is degraded UX, not a build failure.
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 403) {
      core.warning(
        "Skipping SARIF upload: security-events: write not available (likely fork PR or missing workflow permissions)",
      );
    } else {
      core.warning(`SARIF upload failed: ${msg}`);
    }
  }
}
