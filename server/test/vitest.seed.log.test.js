import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED } from '../../scripts/test-seed.js';

// Testing standard C5: the seed is logged outside the test process before it
// runs, so a crash cannot take the reproducer with it. Vitest prints the seed
// itself, but only from inside the process that might crash.
//
// The wrapper runs against a stub, never the real Vitest: a real inner run
// would collect this file and start another, without end.

const wrapper = fileURLToPath(new URL('../../scripts/vitest-run.js', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/vitest-stub.js', import.meta.url));

const run = (env, bin = stub) =>
  spawnSync(process.execPath, [wrapper, 'server/test/x.test.js'], {
    env: { ...process.env, DB8_VITEST_BIN: bin, ...env },
    encoding: 'utf8',
    timeout: 10_000
  });

describe('vitest-run logs the seed before Vitest starts', () => {
  it('logs the pinned seed when VITEST_SEED is unset, and passes it on', () => {
    const r = run({ VITEST_SEED: '' });
    expect(r.status).toBe(0);
    expect(r.stderr.split('\n')[0]).toBe(
      `vitest seed ${DEFAULT_SEED} (reproduce with VITEST_SEED=${DEFAULT_SEED})`
    );
    expect(JSON.parse(r.stdout)).toEqual({
      args: ['run', 'server/test/x.test.js'],
      seed: String(DEFAULT_SEED)
    });
  });

  it('logs an overriding VITEST_SEED', () => {
    const r = run({ VITEST_SEED: '12345' });
    expect(r.status).toBe(0);
    expect(r.stderr.split('\n')[0]).toBe('vitest seed 12345 (reproduce with VITEST_SEED=12345)');
    expect(JSON.parse(r.stdout).seed).toBe('12345');
  });

  it('refuses a seed that is not an integer, before starting Vitest', () => {
    const r = run({ VITEST_SEED: 'abc' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/VITEST_SEED must be an integer/);
    expect(r.stdout).toBe('');
  });

  it('refuses a seed outside the safe integer range', () => {
    // '9'.repeat(400) is all digits, and Number() makes it Infinity.
    for (const seed of ['9'.repeat(400), '9007199254740993']) {
      const r = run({ VITEST_SEED: seed });
      expect(r.status, seed).toBe(2);
      expect(r.stderr).toMatch(/VITEST_SEED must be an integer/);
    }
  });

  it('refuses to start the real Vitest from inside a Vitest run', () => {
    const r = run({ VITEST: 'true' }, '');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to start Vitest from inside a Vitest run/);
  });
});
