import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    // Integration suites may compile the migration binary in beforeAll before
    // starting their isolated server.
    hookTimeout: 60_000,
    // Every integration suite spawns a real server on a fixed port. Running the
    // files in parallel makes them contend for CPU and sockets, which showed up
    // as intermittent "other side closed" failures — a flaky suite is useless as
    fileParallelism: false,
  },
})
