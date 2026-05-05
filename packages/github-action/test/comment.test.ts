import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanFinding } from '../src/types.js';
import { CLEAN_BODY, STICKY_MARKER } from '../src/comment.format.js';

const mocks = vi.hoisted(() => ({
  listComments: vi.fn(),
  updateComment: vi.fn(),
  createComment: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
const { listComments, updateComment, createComment, warning, info } = mocks;

vi.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    repo: { owner: 'Hookwarden', repo: 'hookwarden' },
    payload: { pull_request: { number: 7 } },
  },
  getOctokit: () => ({
    rest: {
      issues: {
        listComments: mocks.listComments,
        updateComment: mocks.updateComment,
        createComment: mocks.createComment,
      },
    },
  }),
}));

vi.mock('@actions/core', () => ({
  warning: mocks.warning,
  info: mocks.info,
}));

import { postOrUpdateStickyComment } from '../src/comment.js';

function mkFinding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    finding_id: 'rule.default@h',
    rule_id: 'rule.default',
    provider: null,
    severity: 'high',
    state: 'not-verified',
    file_path: 'src/x.ts',
    location: { line: 1, col: 0 },
    primary_location_line_hash: 'h',
    message: 'Webhook not verified.',
    redacted_snippet: null,
    suppressed: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['GITHUB_TOKEN'] = 'ghs_test_token';
  listComments.mockResolvedValue({ data: [] });
  updateComment.mockResolvedValue({ data: { id: 999 } });
  createComment.mockResolvedValue({ data: { id: 1234 } });
});

describe('postOrUpdateStickyComment dispatch', () => {
  it('skips when eventName !== pull_request (D-85)', async () => {
    await postOrUpdateStickyComment({
      newFindings: [mkFinding()],
      findingsCount: 1,
      isFork: false,
      eventName: 'push',
    });
    expect(listComments).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('skips with warning when isFork (T-05-03-04)', async () => {
    await postOrUpdateStickyComment({
      newFindings: [mkFinding()],
      findingsCount: 1,
      isFork: true,
      eventName: 'pull_request',
    });
    expect(listComments).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('fork PRs'));
  });

  it('updates existing sticky when marker + bot identity match (T-05-03-01 happy path)', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 555,
          body: `${STICKY_MARKER}\n## previous body`,
          user: { login: 'github-actions[bot]' },
        },
      ],
    });
    await postOrUpdateStickyComment({
      newFindings: [mkFinding()],
      findingsCount: 1,
      isFork: false,
      eventName: 'pull_request',
    });
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 555 }),
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it('creates a new comment when marker present but author is NOT bot (T-05-03-01 attack defense)', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 555,
          body: `${STICKY_MARKER}\n attacker content`,
          user: { login: 'attacker-account' },
        },
      ],
    });
    await postOrUpdateStickyComment({
      newFindings: [mkFinding()],
      findingsCount: 1,
      isFork: false,
      eventName: 'pull_request',
    });
    expect(createComment).toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('silent on clean: no findings + no existing → no API writes (D-83)', async () => {
    await postOrUpdateStickyComment({
      newFindings: [],
      findingsCount: 0,
      isFork: false,
      eventName: 'pull_request',
    });
    expect(updateComment).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it('updates prior sticky to CLEAN_BODY when newFindings empty + existing present (D-83)', async () => {
    listComments.mockResolvedValue({
      data: [
        {
          id: 777,
          body: `${STICKY_MARKER}\nold findings table`,
          user: { login: 'github-actions[bot]' },
        },
      ],
    });
    await postOrUpdateStickyComment({
      newFindings: [],
      findingsCount: 0,
      isFork: false,
      eventName: 'pull_request',
    });
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 777, body: CLEAN_BODY }),
    );
  });

  it('rendered body includes findingsCount footer', async () => {
    await postOrUpdateStickyComment({
      newFindings: [mkFinding()],
      findingsCount: 99,
      isFork: false,
      eventName: 'pull_request',
    });
    const body = createComment.mock.calls[0]?.[0]?.body as string;
    expect(body).toContain('Total findings in this PR: 99');
  });
});
