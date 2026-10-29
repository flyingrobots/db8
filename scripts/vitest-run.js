#!/usr/bin/env node
// Runs `vitest run <args>` after logging the shuffle seed to stderr, outside
// the test process, so a crash cannot take the reproducer with it (testing
// standard C5). Every test launch goes through here: npm run test:inner,
// scripts/test-docker.sh, and the CI workflows.
//
// DB8_VITEST_BIN replaces the Vitest entry point; server/test uses it to run
// this script against a stub. Starting the real Vitest from inside a Vitest
// run is refused: the inner run would collect the same tests and start
// another, without end.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveSeed } from './test-seed.js';

const override = process.env.DB8_VITEST_BIN;
if (!override && process.env.VITEST) {
  console.error('vitest-run: refusing to start Vitest from inside a Vitest run');
  process.exit(2);
}

let seed;
try {
  seed = resolveSeed();
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
console.error(`vitest seed ${seed} (reproduce with VITEST_SEED=${seed})`);

const vitest = override || createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITEST_SEED: String(seed) }
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
