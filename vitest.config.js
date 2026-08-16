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
    setupFiles: ['./server/test/setup.env.js']
  }
};

