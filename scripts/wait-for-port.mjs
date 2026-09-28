#!/usr/bin/env node
// wait-for-port.mjs — dev-only startup gate.
// Polls 127.0.0.1:PORT until it accepts TCP connections, so `vite` (which
// proxies /api and /ws to the Rust server) only starts once the API is up.
// Without this, `concurrently` boots both at once and Vite logs
// "ws proxy error: ECONNREFUSED" on every start.
//
// Usage: node scripts/wait-for-port.mjs <port> [timeoutMs]
import net from 'node:net'

const port = Number(process.argv[2])
const timeoutMs = Number(process.argv[3] ?? 120_000)
const intervalMs = 200

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`wait-for-port: invalid port: ${process.argv[2] ?? '(missing)'}`)
  process.exit(2)
}

const deadline = Date.now() + timeoutMs

function tryOnce() {
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

let announced = false
for (;;) {
  if (await tryOnce()) process.exit(0)
  if (Date.now() >= deadline) {
    console.error(`wait-for-port: timed out after ${timeoutMs}ms waiting for 127.0.0.1:${port}`)
    process.exit(1)
  }
  if (!announced) {
    console.error(`wait-for-port: waiting for 127.0.0.1:${port} ...`)
    announced = true
  }
  await new Promise((r) => setTimeout(r, intervalMs))
}
