#!/usr/bin/env node
/**
 * WebSocket matchmaking load test.
 * Usage: node scripts/load-test.mjs --url=ws://127.0.0.1:8787/ws --clients=40 --seconds=20
 */
import WebSocket from 'ws'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

const url = args.url ?? 'ws://127.0.0.1:8787/ws'
const clients = Number(args.clients ?? 20)
const seconds = Number(args.seconds ?? 15)

const prefs = {
  country: 'any',
  language: 'any',
  gender: 'any',
  lookingFor: 'any',
  interests: ['music'],
}

let matched = 0
let errors = 0
let waiting = 0
const sockets = []

console.log(JSON.stringify({ event: 'start', url, clients, seconds }))

const start = Date.now()

for (let i = 0; i < clients; i++) {
  await new Promise((r) => setTimeout(r, 20))
  const ws = new WebSocket(url)
  sockets.push(ws)
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'queue:join', preferences: prefs }))
  })
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data))
      if (msg.type === 'queue:waiting') waiting += 1
      if (msg.type === 'room:matched') matched += 1
      if (msg.type === 'error') errors += 1
    } catch {
      errors += 1
    }
  })
  ws.on('error', () => {
    errors += 1
  })
}

await new Promise((r) => setTimeout(r, seconds * 1000))

for (const ws of sockets) {
  try {
    ws.send(JSON.stringify({ type: 'queue:leave' }))
    ws.close()
  } catch {
    /* ignore */
  }
}

const elapsedMs = Date.now() - start
console.log(
  JSON.stringify({
    event: 'done',
    elapsedMs,
    clients,
    matchedEvents: matched,
    approxPairs: Math.floor(matched / 2),
    waitingEvents: waiting,
    errors,
    matchesPerSec: (matched / 2 / (elapsedMs / 1000)).toFixed(2),
  }),
)

process.exit(errors > clients ? 1 : 0)
