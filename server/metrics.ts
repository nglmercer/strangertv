const counters = new Map<string, number>()
const timings: number[] = []
const MAX_TIMINGS = 500

export function inc(name: string, by = 1) {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function observeMs(name: string, ms: number) {
  inc(`${name}_count`)
  timings.push(ms)
  if (timings.length > MAX_TIMINGS) timings.shift()
  // keep named histograms light: store last value + count only
  counters.set(`${name}_last_ms`, Math.round(ms))
}

export function snapshot() {
  const values = Object.fromEntries(counters.entries())
  const sorted = [...timings].sort((a, b) => a - b)
  const p = (q: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! : 0
  return {
    counters: values,
    matchLatencyMs: {
      p50: p(0.5),
      p95: p(0.95),
      samples: sorted.length,
    },
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }
}
