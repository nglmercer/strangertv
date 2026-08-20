import { defineConfig } from '@playwright/test'

const port = process.env.E2E_PORT ?? '8797'
const base = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: base,
    headless: true,
  },
  webServer: {
    // E2E_SERVER_CMD selects which server to exercise, mirroring SERVER_CMD in
    // the vitest suites (see docs/rust-migration-plan.md).
    command: `npm run build && ${process.env.E2E_SERVER_CMD ?? 'npx tsx server/index.ts'}`,
    // Must be a real route: /api/health (unversioned) falls through to the SPA
    // handler and returns index.html with a 200, so it never proves the API is up.
    url: `${base}/api/v1/health/live`,
    // Dedicated E2E port avoids clashes with dev servers on 8787
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: port,
      ADMIN_KEY: 'test-admin-key',
      CORS_ORIGINS: `${base},http://localhost:${port}`,
      APP_URL: base,
      NODE_ENV: 'test',
      STATIC_DIR: `${process.cwd()}/dist`,
    },
  },
})
