// Sticky PR summary comment dispatch.
//
// D-81: find existing comment via STICKY_MARKER + identity check.
// D-83: silent on clean; update prior sticky to CLEAN_BODY when present.
// T-05-03-01: identity verification — c.user.login === BOT_LOGIN BEFORE editing.
// T-05-03-04: skip-with-warning on fork PRs (pull-requests:write unavailable).

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  BOT_LOGIN,
  CLEAN_BODY,
  STICKY_MARKER,
  renderSummaryBody,
} from './comment.format.js';
import type { ScanFinding } from './types.js';

export interface PostCommentInput {
  readonly newFindings: ReadonlyArray<ScanFinding>;
  readonly findingsCount: number;
  readonly isFork: boolean;
  readonly eventName: string;
  // codeScanningUrl is intentionally NOT in this interface — derived internally
  // from github.context so producers don't need to know URL conventions.
}

interface PullRequestPayloadShape {
  readonly number: number;
}

export async function postOrUpdateStickyComment(
  input: PostCommentInput,
): Promise<void> {
  if (input.eventName !== 'pull_request') return;

  if (input.isFork) {
    core.warning(
      'Skipping PR comment: pull-requests:write not available on fork PRs',
    );
    return;
  }

  const pr = github.context.payload['pull_request'] as
    | PullRequestPayloadShape
    | undefined;
  if (pr === undefined || typeof pr.number !== 'number') return;
  const issueNumber = pr.number;

  const token = process.env['GITHUB_TOKEN'];
  if (typeof token !== 'string' || token.length === 0) {
    core.warning('Skipping PR comment: GITHUB_TOKEN not available');
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const codeScanningUrl = `https://github.com/${owner}/${repo}/security/code-scanning?query=is%3Aopen+pr%3A${issueNumber}`;

  try {
    // T-05-03-03: per_page=100 cap. PRs with >100 comments may miss a prior
    // sticky → posts a duplicate. Acceptable; pathological case only.
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    const existing = comments.find(
      (c) =>
        typeof c.body === 'string' &&
        c.body.includes(STICKY_MARKER) &&
        c.user?.login === BOT_LOGIN,
    );

    if (input.newFindings.length === 0) {
      if (existing !== undefined) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body: CLEAN_BODY,
        });
        core.info(`Updated sticky comment ${existing.id} to clean state`);
      }
      return;
    }

    const body = renderSummaryBody({
      newFindings: input.newFindings,
      findingsCount: input.findingsCount,
      codeScanningUrl,
    });

    if (existing !== undefined) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
      core.info(`Updated sticky comment ${existing.id}`);
    } else {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      core.info(`Created sticky comment ${data.id}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`PR comment failed: ${msg}`);
  }
}
