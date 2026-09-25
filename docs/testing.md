# Testing

How to run each suite. CI (`.github/workflows/ci.yml`) runs type-check,
generated-contract check, Rust tests, black-box suites, a production build,
Playwright e2e, and a Docker health regression.

## Command map

| Command | What it runs |
|---------|--------------|
| `npm run check` | TypeScript project build (`tsc -b`) |
| `npm run check:generated` | Fail if `shared/generated` is stale vs `rust/src/proto` |
| `npm run rust:test` | Rust unit + integration tests (`cd rust && cargo test`) |
| `npm test` | Build release binary, then Vitest black-box HTTP/WS suites |
| `npm run test:integration` | Live HTTP API tests only (`tests/api.integration.test.ts`) |
| `npm run test:e2e` | Playwright end-to-end (`e2e/`, needs `npx playwright install chromium` once) |
| `npm run test:all` | check + generated + rust + build + suites + e2e |

## Notes

- `npm test` and `test:integration` build the server first and exercise the
  real binary, including Node-database compatibility (scrypt hash, session
  token, idempotent migrate over the old schema).
- Playwright's `webServer` builds the release binary (`npm run build:all`);
  e2e runs with `CI=1` in the `test:all` chain.
- `make check` adds `cargo clippy --all-targets` with warnings denied.
- Stress and post-deploy probes live outside the test suites:
  `npm run loadtest`, `npm run smoke` — see [Operations](./operations.md).

Related: [Development](./development.md).
