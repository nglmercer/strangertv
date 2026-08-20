import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { API_ROUTES } from '../../shared/constants'

/**
 * Spawns the API server for black-box tests.
 *
 * These suites drive the server over HTTP/WS only, so they are
 * implementation-language agnostic. `SERVER_CMD` selects which binary to run
 * during the Rust migration — the default keeps the TypeScript server:
 *
 *   SERVER_CMD="./rust/target/debug/stranger-server" npm run test:integration
 *
 * The command is split on whitespace; the first word is the executable.
 */
export function spawnServer(env: Record<string, string>): ChildProcess {
  const cmd = process.env.SERVER_CMD ?? 'npx tsx server/index.ts'
  const [bin, ...args] = cmd.split(/\s+/).filter(Boolean)
  return spawn(bin!, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Polls the liveness endpoint until the server answers or the budget runs out. */
export async function waitHealthy(base: string, ms = 15_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${base}${API_ROUTES.healthLive}`)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  throw new Error(`server did not become healthy within ${ms}ms`)
}

/** SIGTERM, then SIGKILL after the drain window. */
export async function stopServer(child: ChildProcess): Promise<void> {
  child.kill('SIGTERM')
  await sleep(300)
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}
