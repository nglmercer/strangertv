import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForApi } from './waitForApi'

/**
 * Boot-time API gate: page loads during a compile/restart must wait for the
 * backend instead of failing once and sticking in a logged-out state.
 */

describe('waitForApi', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves on the first probe when the API is already up', async () => {
    const probe = vi.fn(async () => ({ ok: true }))
    const result = await waitForApi(probe, { timeoutMs: 1000, retryMs: 100 })
    expect(result).toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('retries until a probe succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = vi.fn(async () => ({ ok: ++calls >= 3 }))
    const pending = waitForApi(probe, { timeoutMs: 10_000, retryMs: 1000 })
    await vi.advanceTimersByTimeAsync(2500)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('falls through with the last failure past the deadline', async () => {
    vi.useFakeTimers()
    const probe = vi.fn(async () => ({ ok: false as const }))
    const pending = waitForApi(probe, { timeoutMs: 2500, retryMs: 1000 })
    await vi.advanceTimersByTimeAsync(5000)
    await expect(pending).resolves.toEqual({ ok: false })
    expect(probe.mock.calls.length).toBeGreaterThan(1)
  })

  it('aborts with null once cancelled', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const probe = vi.fn(async () => ({ ok: false as const }))
    const pending = waitForApi(probe, {
      timeoutMs: 10_000,
      retryMs: 1000,
      isCancelled: () => cancelled,
    })
    cancelled = true
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBeNull()
  })
})
