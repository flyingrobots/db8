export default {
  test: {
    environment: 'node',
    restoreMocks: true,
    reporters: ['default'],
    globals: true,
    setupFiles: ['./server/test/setup.env.js']
  }
};

