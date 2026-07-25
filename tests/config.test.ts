import { describe, it, expect } from 'vitest'
import { prometheusText, inc, snapshot } from '../server/metrics'

describe('metrics', () => {
  it('exposes prometheus counters', () => {
    inc('test_counter_xyz', 1)
    const text = prometheusText({ queue_waiting: 2 })
    expect(text).toMatch(/stranger_uptime_seconds/)
    expect(text).toMatch(/stranger_queue_waiting 2/)
    expect(text).toMatch(/test_counter_xyz/)
    const snap = snapshot()
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0)
  })
})
