import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'tinyglobby';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const PKG_ROOT = join(__dirname, '..');
const ENGINE_DIST = join(PKG_ROOT, 'dist');

const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ['node:fs',          /["']node:fs(?:\/promises)?["']/],
  ['fs',               /\brequire\(\s*["']fs(?:\/promises)?["']\s*\)|from\s+["']fs(?:\/promises)?["']/],
  ['http',             /["']node:http["']|require\(\s*["']http["']\s*\)|from\s+["']http["']/],
  ['https',            /["']node:https["']|require\(\s*["']https["']\s*\)|from\s+["']https["']/],
  ['net',              /["']node:net["']|require\(\s*["']net["']\s*\)|from\s+["']net["']/],
  ['child_process',    /["']node:child_process["']|require\(\s*["']child_process["']\s*\)|from\s+["']child_process["']/],
  ['process.cwd',      /\bprocess\.cwd\s*\(/],
  ['process.env',      /\bprocess\.env\b/],
  ['globalThis.fetch', /\bglobalThis\.fetch\b/],
  ['axios',            /["']axios["']/],
  ['node-fetch',       /["']node-fetch["']/],
  ['undici',           /["']undici["']/],
  ['got',              /["']got["']/],
];

beforeAll(() => {
  // Pitfall #3 mitigation: force a fresh build so we never grep stale output.
  execSync('pnpm exec tsc --build --force', { cwd: join(PKG_ROOT, '..', '..') });
  if (!existsSync(ENGINE_DIST)) {
    throw new Error(`Engine dist directory missing after build: ${ENGINE_DIST}`);
  }
});

describe('engine purity (compiled output grep)', () => {
  it('dist/ contains at least one .js file (anti-stale-dist guard)', () => {
    const files = globSync('**/*.js', { cwd: ENGINE_DIST, absolute: true });
    expect(files.length).toBeGreaterThan(0);
  });

  it('every compiled .js file is free of forbidden symbols', () => {
    const files = globSync('**/*.js', { cwd: ENGINE_DIST, absolute: true });
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Strip block and line comments first so doc text doesn't false-positive.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [name, pattern] of FORBIDDEN_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(`${file.replace(ENGINE_DIST + '/', '')} contains forbidden symbol: ${name}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
