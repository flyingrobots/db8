export default {
  test: {
    // Scoped explicitly. Vitest's default pattern also matches web/**/*.spec.js,
    // which is where the Playwright suite lives — it would be collected here and
    // fail, because Playwright's `test` is not Vitest's.
    include: ['server/test/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
    reporters: ['default'],
    globals: true,
    setupFiles: ['./server/test/setup.env.js'],

    // Randomized order, on by default.
    //
    // A test that only passes in declaration order is depending on another
    // test's writes, and four files were doing exactly that: a submission id
    // filled by the first test and read by three later ones, verdict-row counts
    // that grew as later tests added rows, an audit assertion that needed an
    // earlier test's delete, and a cache read of what an earlier test fetched.
    // All four passed every run and would have kept passing indefinitely,
    // because nothing ever ran them in a different order.
    //
    // The seed is pinned so a failure is reproducible and so an ordinary run is
    // not a different experiment each time. Override it to explore other
    // orderings, which is worth doing periodically:
    //
    //   VITEST_SEED=12345 npm run test:inner
    //
    // A failure that appears only under a particular seed is a real defect in
    // test isolation; re-running until green is not a fix (I11).
    sequence: {
      shuffle: { files: true, tests: true },
      seed: Number(process.env.VITEST_SEED ?? 20260816)
    }
  }
};

