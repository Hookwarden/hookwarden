import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const ENGINE_FIXTURE = join(ROOT, 'packages/engine/src/__purity-fixture.ts');
const CLI_FIXTURE = join(ROOT, 'packages/cli/src/__test-fixture.ts');

function depcruise(): { code: number; output: string } {
  try {
    const out = execSync(
      'pnpm exec depcruise --config .dependency-cruiser.cjs packages',
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { code: 0, output: out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

afterEach(() => {
  for (const f of [ENGINE_FIXTURE, CLI_FIXTURE]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe('dep-cruiser engine purity rules', () => {
  it('passes on the clean engine', () => {
    const { code } = depcruise();
    expect(code).toBe(0);
  });

  it('rejects fs import inside packages/engine/src (engine-no-node-core)', () => {
    writeFileSync(ENGINE_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-node-core/);
  });

  it('rejects axios import inside packages/engine/src (engine-no-network-libs)', () => {
    writeFileSync(ENGINE_FIXTURE, "import 'axios';\nexport const x = 1;\n");
    const { code, output } = depcruise();
    expect(code).not.toBe(0);
    expect(output).toMatch(/engine-no-network-libs/);
  });

  it('allows fs import inside packages/cli/src (cli is the I/O boundary, Pitfall #6)', () => {
    writeFileSync(CLI_FIXTURE, "import 'fs';\nexport const x = 1;\n");
    const { code } = depcruise();
    expect(code).toBe(0);
  });
});
