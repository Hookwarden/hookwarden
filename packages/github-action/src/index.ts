// GitHub Action entrypoint.
//
// D-87: 3 inputs (fail-on, config-path, working-directory).
// D-88: 4 outputs (findings-count, new-findings-count, findings-by-severity, sarif-path).
// ACTION-04: CLI exit 1 (findings ≥ fail-on) → core.setFailed → workflow check fails.
//
// Plan 03 (sticky comment) and Plan 04 (SARIF upload) are dynamic-imported so this
// plan ships standalone; failures in those modules surface as warnings, not failures.

import * as core from '@actions/core';
import { runActionScan } from './scan.js';
import type { ActionInputs } from './types.js';

function readInputs(): ActionInputs {
  const configPath = core.getInput('config-path');
  return {
    failOn: core.getInput('fail-on') || 'high',
    configPath: configPath !== '' ? configPath : undefined,
    workingDirectory: core.getInput('working-directory') || '.',
  };
}

export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const result = await runActionScan(inputs);

    // D-88: 4 outputs
    core.setOutput('findings-count', result.findingsCount);
    core.setOutput('new-findings-count', result.newFindingsCount);
    core.setOutput('findings-by-severity', JSON.stringify(result.bySeverity));
    core.setOutput('sarif-path', result.sarifPath);

    // Plan 03 — sticky PR comment (skip on non-PR or fork events)
    if (result.eventName === 'pull_request' && !result.isFork) {
      try {
        const commentMod = await import('./comment.js');
        await commentMod.postOrUpdateStickyComment({
          newFindings: result.newFindings,
          findingsCount: result.findingsCount,
          isFork: result.isFork,
          eventName: result.eventName,
        });
      } catch (err) {
        core.warning(`Sticky comment failed: ${(err as Error).message}`);
      }
    } else if (result.isFork) {
      core.warning(
        'Skipping PR summary comment: pull-requests:write unavailable on fork PRs',
      );
    }

    // Plan 04 — SARIF upload (uploadSarif handles the fork-PR skip internally)
    try {
      const sarifMod = await import('./sarif-upload.js');
      await sarifMod.uploadSarif({
        sarifPath: result.sarifPath,
        isFork: result.isFork,
      });
    } catch (err) {
      core.warning(`SARIF upload failed: ${(err as Error).message}`);
    }

    if (result.failed) {
      core.setFailed(
        `hookwarden: ${result.newFindingsCount} new finding(s) at or above ${inputs.failOn}`,
      );
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

void run();
