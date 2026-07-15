import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prometheusText, inc, snapshot } from './metrics'

describe('metrics', () => {
  it('exposes prometheus counters', () => {
    inc('test_counter_xyz', 1)
    const text = prometheusText({ queue_waiting: 2 })
    assert.match(text, /stranger_uptime_seconds/)
    assert.match(text, /stranger_queue_waiting 2/)
    assert.match(text, /test_counter_xyz/)
    const snap = snapshot()
    assert.ok(snap.uptimeSec >= 0)
  })
})
