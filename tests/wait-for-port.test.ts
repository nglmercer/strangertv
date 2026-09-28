import { describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'wait-for-port.mjs',
)

function runWaiter(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
}

async function listenEphemeral(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no listen address')
  return { server, port: address.port }
}

async function closedPort(): Promise<number> {
  const { server, port } = await listenEphemeral()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('scripts/wait-for-port.mjs', () => {
  test('exits 0 when the port is already listening', async () => {
    const { server, port } = await listenEphemeral()
    try {
      await expect(runWaiter([String(port), '5000'])).resolves.toBe(0)
    } finally {
      server.close()
    }
  })

  test('exits nonzero when nothing listens before the timeout', async () => {
    const port = await closedPort()
    await expect(runWaiter([String(port), '600'])).resolves.toBe(1)
  })

  test('exits 2 on an invalid port', async () => {
    await expect(runWaiter(['not-a-port', '1000'])).resolves.toBe(2)
  })
})
