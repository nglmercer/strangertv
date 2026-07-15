import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    // Production-like: Hono serves dist + API + WS on one port
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8787',
    headless: true,
  },
  webServer: {
    command: 'npm run build && npx tsx server/index.ts',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: '8787',
      ADMIN_KEY: 'test-admin-key',
      CORS_ORIGINS: 'http://127.0.0.1:8787,http://localhost:8787',
      APP_URL: 'http://127.0.0.1:8787',
      NODE_ENV: 'test',
      STATIC_DIR: `${process.cwd()}/dist`,
    },
  },
})
