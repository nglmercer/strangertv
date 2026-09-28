import { describe, expect, test } from 'vitest'
import { execFile, execSync, spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'free-ports.sh',
)

function hasBackend(): boolean {
  try {
    execSync('command -v bash && (command -v fuser || command -v lsof)', {
      stdio: 'ignore',
      shell: '/bin/sh',
    })
    return true
  } catch {
    return false
  }
}

async function freeTcpPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no listen address')
  const port = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

// The victim must be a SEPARATE process: free-ports kills by socket
// ownership, so an in-worker listener would SIGKILL the test runner itself.
function spawnListener(port: number): ChildProcess {
  return spawn(
    process.execPath,
    ['--eval', `require("net").createServer().listen(${port}, "127.0.0.1")`],
    { stdio: 'ignore' },
  )
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForConnectable(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await tryConnect(port)) return
    await sleep(50)
  }
  throw new Error(`port ${port} never became connectable`)
}

async function waitForRefused(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await tryConnect(port))) return
    await sleep(50)
  }
  throw new Error(`port ${port} still accepting connections after free-ports`)
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return
    await sleep(50)
  }
  throw new Error('listener process still alive after free-ports')
}

function runScript(env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile('bash', [SCRIPT], { env: { ...process.env, ...env } }, (error) => {
      if (error && !('code' in error)) reject(error)
      else resolve(error ? Number((error as { code: unknown }).code) : 0)
    })
  })
}

describe.skipIf(!hasBackend())('scripts/free-ports.sh', () => {
  test('frees a held port without touching anything else', async () => {
    const port = await freeTcpPort()
    const victim = spawnListener(port)
    try {
      await waitForConnectable(port, 10_000)
      // Scoped to our scratch port; sweeps off so a live dev session in
      // another terminal is never harmed by the test suite.
      const code = await runScript({ FREE_PORTS: String(port), FREE_PORTS_SWEEP: '0' })
      expect(code).toBe(0)
      await waitForExit(victim, 10_000)
      await waitForRefused(port, 10_000)
    } finally {
      victim.kill('SIGKILL')
    }
  })
})
