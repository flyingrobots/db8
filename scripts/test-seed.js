// The Vitest shuffle seed, resolved in one place for vitest.config.js and for
// scripts/vitest-run.js, which logs it before Vitest starts (testing standard
// C5). Rationale: docs/adr/0004-randomized-test-order.md.

export const DEFAULT_SEED = 20260816;

// An unset or empty VITEST_SEED is the pinned default. Anything else must be a
// safe integer: Number('abc') is NaN, a long enough digit string is Infinity,
// and above 2^53 two different strings give one seed. None is a reproducer.
export function resolveSeed(env = process.env) {
  const raw = env.VITEST_SEED;
  if (raw === undefined || raw === '') return DEFAULT_SEED;
  const seed = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`VITEST_SEED must be an integer, got ${JSON.stringify(raw)}`);
  }
  return seed;
}
