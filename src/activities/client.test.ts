import { describe, expect, it, vi } from 'vitest'
import { ACTIVITY_MSG, createActivityGuest, createActivityHost } from './client'

const ORIGIN = 'https://chat.test'

type Listener = (e: { origin: string; source: unknown; data: unknown }) => void

function stubWindow() {
  const listeners = new Set<Listener>()
  const parent = { postMessage: vi.fn() }
  const win = {
    location: { origin: ORIGIN },
    parent: parent as unknown,
    addEventListener: (_t: 'message', cb: Listener) => listeners.add(cb),
    removeEventListener: (_t: 'message', cb: Listener) => listeners.delete(cb),
  }
  const emit = (e: { origin: string; source: unknown; data: unknown }) => listeners.forEach((cb) => cb(e))
  return { win, parent, emit, listenerCount: () => listeners.size }
}

describe('createActivityGuest', () => {
  it('routes init, state, presence, and ended from the parent', () => {
    const { win, parent, emit } = stubWindow()
    const guest = createActivityGuest({ win, parent })
    const seen: string[] = []
    guest.onInit((i) => seen.push(`init:${i.instanceId}:${i.code}`))
    guest.onState((uid, st) => seen.push(`state:${uid}:${JSON.stringify(st)}`))
    guest.onPresence((ps) => seen.push(`presence:${ps.map((p) => p.name).join(',')}`))
    guest.onEnded(() => seen.push('ended'))

    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.init, code: 'c1', instanceId: 7 } })
    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.state, userId: 2, state: { n: 1 } } })
    emit({
      origin: ORIGIN,
      source: parent,
      data: { type: ACTIVITY_MSG.presence, participants: [{ userId: 2, name: 'Bo' }] },
    })
    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.ended } })

    expect(seen).toEqual(['init:7:c1', 'state:2:{"n":1}', 'presence:Bo', 'ended'])
  })

  it('ignores cross-origin, wrong-source, and malformed messages', () => {
    const { win, parent, emit } = stubWindow()
    const guest = createActivityGuest({ win, parent })
    const cb = vi.fn()
    guest.onInit(cb)
    guest.onState(cb)
    guest.onPresence(cb)
    guest.onEnded(cb)

    emit({ origin: 'https://evil.test', source: parent, data: { type: ACTIVITY_MSG.init, code: 'x', instanceId: 1 } })
    emit({ origin: ORIGIN, source: {}, data: { type: ACTIVITY_MSG.init, code: 'x', instanceId: 1 } })
    emit({ origin: ORIGIN, source: parent, data: null })
    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.init, code: '', instanceId: 1 } })
    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.init, instanceId: 1 } })
    emit({ origin: ORIGIN, source: parent, data: { type: ACTIVITY_MSG.state, userId: 2 } })
    emit({ origin: ORIGIN, source: parent, data: { type: 'activity:nope' } })

    expect(cb).not.toHaveBeenCalled()
  })

  it('posts ready, publish, and leave to the parent origin', () => {
    const { win, parent } = stubWindow()
    const guest = createActivityGuest({ win, parent })
    guest.ready()
    guest.publish({ move: 3 })
    guest.leave()
    expect(parent.postMessage).toHaveBeenNthCalledWith(1, { type: ACTIVITY_MSG.ready }, ORIGIN)
    expect(parent.postMessage).toHaveBeenNthCalledWith(2, { type: ACTIVITY_MSG.publish, state: { move: 3 } }, ORIGIN)
    expect(parent.postMessage).toHaveBeenNthCalledWith(3, { type: ACTIVITY_MSG.leave }, ORIGIN)
  })

  it('dispose detaches the listener', () => {
    const stubs = stubWindow()
    const guest = createActivityGuest({ win: stubs.win, parent: stubs.parent })
    expect(stubs.listenerCount()).toBe(1)
    guest.dispose()
    expect(stubs.listenerCount()).toBe(0)
  })
})

describe('createActivityHost', () => {
  function stubHost() {
    const stubs = stubWindow()
    const contentWindow = { postMessage: vi.fn() }
    const host = createActivityHost({ contentWindow }, { win: stubs.win })
    return { ...stubs, contentWindow, host: host! }
  }

  it('routes ready, publish, and leave from the iframe', () => {
    const { host, emit, contentWindow } = stubHost()
    const seen: string[] = []
    host.onReady(() => seen.push('ready'))
    host.onPublish((s) => seen.push(`publish:${JSON.stringify(s)}`))
    host.onLeave(() => seen.push('leave'))

    emit({ origin: ORIGIN, source: contentWindow, data: { type: ACTIVITY_MSG.ready } })
    emit({ origin: ORIGIN, source: contentWindow, data: { type: ACTIVITY_MSG.publish, state: [1] } })
    emit({ origin: ORIGIN, source: contentWindow, data: { type: ACTIVITY_MSG.leave } })

    expect(seen).toEqual(['ready', 'publish:[1]', 'leave'])
  })

  it('ignores cross-origin, wrong-source, and malformed messages', () => {
    const { host, emit, contentWindow } = stubHost()
    const cb = vi.fn()
    host.onReady(cb)
    host.onPublish(cb)
    host.onLeave(cb)

    emit({ origin: 'https://evil.test', source: contentWindow, data: { type: ACTIVITY_MSG.ready } })
    emit({ origin: ORIGIN, source: {}, data: { type: ACTIVITY_MSG.ready } })
    emit({ origin: ORIGIN, source: contentWindow, data: { type: ACTIVITY_MSG.publish } })
    emit({ origin: ORIGIN, source: contentWindow, data: 'activity:ready' })

    expect(cb).not.toHaveBeenCalled()
  })

  it('pushes init, state, presence, and ended into the iframe', () => {
    const { host, contentWindow } = stubHost()
    host.init('code-9', 4)
    host.pushState(2, { n: 5 })
    host.pushPresence([{ userId: 2, name: 'Bo' }])
    host.pushEnded()
    expect(contentWindow.postMessage).toHaveBeenNthCalledWith(
      1,
      { type: ACTIVITY_MSG.init, code: 'code-9', instanceId: 4 },
      ORIGIN,
    )
    expect(contentWindow.postMessage).toHaveBeenNthCalledWith(
      2,
      { type: ACTIVITY_MSG.state, userId: 2, state: { n: 5 } },
      ORIGIN,
    )
    expect(contentWindow.postMessage).toHaveBeenNthCalledWith(
      3,
      { type: ACTIVITY_MSG.presence, participants: [{ userId: 2, name: 'Bo' }] },
      ORIGIN,
    )
    expect(contentWindow.postMessage).toHaveBeenNthCalledWith(4, { type: ACTIVITY_MSG.ended }, ORIGIN)
  })

  it('returns null without a content window', () => {
    const { win } = stubWindow()
    expect(createActivityHost({ contentWindow: null }, { win })).toBeNull()
  })
})
