import { describe, expect, it } from 'vitest'
import { buildAudioConstraints, isDenoiserSupported } from './denoiser'

describe('buildAudioConstraints', () => {
  it('always requests echo cancellation and AGC as ideal constraints', () => {
    const c = buildAudioConstraints('', { deviceIdMode: 'ideal', denoiseOn: false })
    expect(c.echoCancellation).toBe(true)
    expect(c.autoGainControl).toBe(true)
    expect('deviceId' in c).toBe(false)
  })

  it('keeps browser noise suppression on only while the WASM denoiser is off', () => {
    expect(buildAudioConstraints('', { deviceIdMode: 'ideal', denoiseOn: false }).noiseSuppression).toBe(true)
    expect(buildAudioConstraints('', { deviceIdMode: 'ideal', denoiseOn: true }).noiseSuppression).toBe(false)
  })

  it('honors exact vs ideal device selection', () => {
    expect(buildAudioConstraints('mic-1', { deviceIdMode: 'exact', denoiseOn: false }).deviceId).toEqual({
      exact: 'mic-1',
    })
    expect(buildAudioConstraints('mic-1', { deviceIdMode: 'ideal', denoiseOn: false }).deviceId).toEqual({
      ideal: 'mic-1',
    })
  })
})

describe('isDenoiserSupported', () => {
  function FakeAudioContext() {}
  // A supporting browser exposes the worklet registry on the prototype.
  FakeAudioContext.prototype.audioWorklet = {}
  const full = {
    AudioContext: FakeAudioContext,
    MediaStream: function MediaStream() {},
    WebAssembly: { compile: async () => ({}) },
  } as unknown as {
    AudioContext?: unknown
    MediaStream?: unknown
    WebAssembly?: unknown
  }

  it('accepts a complete environment', () => {
    expect(isDenoiserSupported(full)).toBe(true)
  })

  it('rejects when AudioContext, MediaStream, or WebAssembly.compile is missing', () => {
    expect(isDenoiserSupported({ ...full, AudioContext: undefined })).toBe(false)
    expect(isDenoiserSupported({ ...full, MediaStream: undefined })).toBe(false)
    expect(isDenoiserSupported({ ...full, WebAssembly: undefined })).toBe(false)
    expect(isDenoiserSupported({ ...full, WebAssembly: {} })).toBe(false)
  })

  it('rejects an AudioContext without the worklet registry', () => {
    function LegacyAudioContext() {}
    expect(isDenoiserSupported({ ...full, AudioContext: LegacyAudioContext })).toBe(false)
  })
})
