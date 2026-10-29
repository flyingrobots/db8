// Stands in for Vitest in vitest.seed.log.test.js: prints what it was started
// with and exits, so the wrapper is tested without starting a test run.
process.stdout.write(
  JSON.stringify({ args: process.argv.slice(2), seed: process.env.VITEST_SEED }) + '\n'
);
