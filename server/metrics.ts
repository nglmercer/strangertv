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

/** Prometheus text exposition (basic counters + gauges). */
export function prometheusText(extraGauges: Record<string, number> = {}) {
  const lines: string[] = [
    '# HELP stranger_uptime_seconds Process uptime',
    '# TYPE stranger_uptime_seconds gauge',
    `stranger_uptime_seconds ${Math.floor(process.uptime())}`,
    '# HELP stranger_memory_rss_bytes Resident set size',
    '# TYPE stranger_memory_rss_bytes gauge',
    `stranger_memory_rss_bytes ${process.memoryUsage().rss}`,
  ]
  for (const [k, v] of Object.entries(extraGauges)) {
    const name = k.replace(/[^a-zA-Z0-9_]/g, '_')
    lines.push(`# TYPE stranger_${name} gauge`, `stranger_${name} ${v}`)
  }
  lines.push('# HELP stranger_counter Application counters', '# TYPE stranger_counter counter')
  for (const [k, v] of counters.entries()) {
    const name = k.replace(/[^a-zA-Z0-9_]/g, '_')
    lines.push(`stranger_counter{name="${name}"} ${v}`)
  }
  const snap = snapshot().matchLatencyMs
  lines.push(
    '# HELP stranger_match_wait_ms Match wait latency quantiles',
    '# TYPE stranger_match_wait_ms summary',
    `stranger_match_wait_ms{quantile="0.5"} ${snap.p50}`,
    `stranger_match_wait_ms{quantile="0.95"} ${snap.p95}`,
    `stranger_match_wait_ms_count ${snap.samples}`,
  )
  return lines.join('\n') + '\n'
}
