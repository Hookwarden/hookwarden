import { describe, expect, it } from 'vitest';
import {
  BOT_LOGIN,
  CLEAN_BODY,
  STICKY_MARKER,
  renderSummaryBody,
} from '../src/comment.format.js';
import type { ScanFinding } from '../src/types.js';

function mkFinding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    finding_id: overrides.rule_id
      ? `${overrides.rule_id}@hash-${overrides.primary_location_line_hash ?? 'x'}`
      : 'rule.default@hash-x',
    rule_id: 'rule.default',
    provider: null,
    severity: 'high',
    state: 'not-verified',
    file_path: 'src/webhooks/handler.ts',
    location: { line: 10, col: 0 },
    primary_location_line_hash: 'hash-x',
    message: 'Webhook signature is not verified.',
    redacted_snippet: null,
    suppressed: null,
    ...overrides,
  };
}

const URL = 'https://example.test/code-scanning';

describe('byte-locked literals', () => {
  it('STICKY_MARKER spelling is exactly <!-- hookwarden:pr-summary -->', () => {
    expect(STICKY_MARKER).toBe('<!-- hookwarden:pr-summary -->');
  });

  it('BOT_LOGIN spelling is exactly github-actions[bot]', () => {
    expect(BOT_LOGIN).toBe('github-actions[bot]');
  });

  it('CLEAN_BODY starts with the marker', () => {
    expect(CLEAN_BODY.startsWith(STICKY_MARKER)).toBe(true);
    expect(CLEAN_BODY).toContain('no new findings');
  });
});

describe('renderSummaryBody', () => {
  it('1 finding produces marker + heading + 1-row table', () => {
    const body = renderSummaryBody({
      newFindings: [mkFinding()],
      findingsCount: 1,
      codeScanningUrl: URL,
    });
    expect(body.startsWith(STICKY_MARKER)).toBe(true);
    expect(body).toContain('## hookwarden: 1 new finding(s)');
    expect(body).toContain('| Severity | Location | Rule | Fix |');
    expect(body).toContain('`src/webhooks/handler.ts:10`');
    expect(body).not.toContain('see Code Scanning');
  });

  it('5 findings produces 5-row table with NO overflow line', () => {
    const findings: ScanFinding[] = Array.from({ length: 5 }, (_, i) =>
      mkFinding({
        rule_id: `rule-${i}`,
        primary_location_line_hash: `h${i}`,
        file_path: `src/f${i}.ts`,
      }),
    );
    const body = renderSummaryBody({
      newFindings: findings,
      findingsCount: 5,
      codeScanningUrl: URL,
    });
    const rowCount = body.split('\n').filter((l) => /^\| (critical|high|medium|low|info) \|/.test(l)).length;
    expect(rowCount).toBe(5);
    expect(body).not.toContain('see Code Scanning');
  });

  it('6 findings produces 5-row table + overflow line', () => {
    const findings: ScanFinding[] = Array.from({ length: 6 }, (_, i) =>
      mkFinding({
        rule_id: `rule-${i}`,
        primary_location_line_hash: `h${i}`,
        file_path: `src/f${i}.ts`,
      }),
    );
    const body = renderSummaryBody({
      newFindings: findings,
      findingsCount: 6,
      codeScanningUrl: URL,
    });
    const rowCount = body.split('\n').filter((l) => /^\| (critical|high|medium|low|info) \|/.test(l)).length;
    expect(rowCount).toBe(5);
    expect(body).toContain('see Code Scanning for 1 more finding(s)');
  });

  it('sorts by severity (critical first), then file_path, then line', () => {
    const findings: ScanFinding[] = [
      mkFinding({ severity: 'low', file_path: 'a.ts', primary_location_line_hash: 'a' }),
      mkFinding({ severity: 'critical', file_path: 'z.ts', primary_location_line_hash: 'z' }),
      mkFinding({ severity: 'high', file_path: 'b.ts', primary_location_line_hash: 'b' }),
      mkFinding({
        severity: 'critical',
        file_path: 'a.ts',
        primary_location_line_hash: 'a2',
      }),
    ];
    const body = renderSummaryBody({
      newFindings: findings,
      findingsCount: 4,
      codeScanningUrl: URL,
    });
    const rows = body.split('\n').filter((l) => l.startsWith('| critical') || l.startsWith('| high') || l.startsWith('| low'));
    expect(rows[0]).toContain('| critical |');
    expect(rows[0]).toContain('a.ts');
    expect(rows[1]).toContain('| critical |');
    expect(rows[1]).toContain('z.ts');
    expect(rows[2]).toContain('| high |');
    expect(rows[3]).toContain('| low |');
  });

  it('severity totals line omits zero-buckets', () => {
    const body = renderSummaryBody({
      newFindings: [mkFinding({ severity: 'critical' })],
      findingsCount: 1,
      codeScanningUrl: URL,
    });
    expect(body).toContain('**Severity:** 1 critical');
    expect(body).not.toContain('0 high');
    expect(body).not.toContain('0 medium');
  });

  it('output is byte-stable across two calls with identical input', () => {
    const findings: ScanFinding[] = [
      mkFinding({ severity: 'high' }),
      mkFinding({ severity: 'critical', file_path: 'src/a.ts' }),
    ];
    const inputs = {
      newFindings: findings,
      findingsCount: 2,
      codeScanningUrl: URL,
    };
    expect(renderSummaryBody(inputs)).toBe(renderSummaryBody(inputs));
  });

  it('uses findingsCount in the footer', () => {
    const body = renderSummaryBody({
      newFindings: [mkFinding()],
      findingsCount: 42,
      codeScanningUrl: URL,
    });
    expect(body).toContain('Total findings in this PR: 42');
  });

  it('renders fix hint as first sentence of message', () => {
    const body = renderSummaryBody({
      newFindings: [
        mkFinding({
          message: 'Verify the signature. Use crypto.timingSafeEqual.',
        }),
      ],
      findingsCount: 1,
      codeScanningUrl: URL,
    });
    expect(body).toContain('Verify the signature');
    expect(body).not.toContain('Use crypto.timingSafeEqual');
  });
});
