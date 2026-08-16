import { defineConfig, devices } from '@playwright/test';

// Browser tests for the room page.
//
// Kept out of `npm test` on purpose: that runs on every push via the pre-push
// hook, and requiring a downloaded browser engine there would make an ordinary
// commit depend on a 95MB install. Run with `npm run test:e2e` from web/.
//
// Both servers are started here rather than assumed. The API runs in memory
// mode, because what is under test is the browser: whether the claim term
// editor renders, builds a term the server accepts, and lets a verdict target
// one node of it. Persistence has its own coverage.
const API_PORT = 3199;
const WEB_PORT = 3198;

export default defineConfig({
  testDir: './e2e',
  // A render bug is deterministic; a flake here would mean a real race.
  retries: 0,
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `DATABASE_URL= NODE_ENV=development PORT=${API_PORT} DB8_ALLOWED_ORIGINS=http://localhost:${WEB_PORT} node ../server/rpc.js`,
      url: `http://localhost:${API_PORT}/state?room_id=00000000-0000-0000-0000-000000000000`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: `NEXT_PUBLIC_DB8_API_URL=http://localhost:${API_PORT} npx next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
