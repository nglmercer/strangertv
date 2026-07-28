type MeterEntry = {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  buffer: Uint8Array<ArrayBuffer>
}

/**
 * Measures RMS audio levels for a set of named MediaStreams using a single
 * shared AudioContext. Analysers are tap-only (never connected to the
 * destination), so they add no audible side effects.
 */
export class AudioLevelMeter {
  private ctx: AudioContext | null = null
  private entries = new Map<string, MeterEntry>()

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined)
      return this.ctx
    }
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      this.ctx = new Ctor()
    } catch {
      this.ctx = null
    }
    return this.ctx
  }

  setStream(id: string, stream: MediaStream | null) {
    const existing = this.entries.get(id)
    if (existing && existing.stream === stream) return

    if (existing) {
      try {
        existing.source.disconnect()
      } catch {
        /* ignore */
      }
      this.entries.delete(id)
    }

    if (!stream || stream.getAudioTracks().length === 0) return
    const ctx = this.ensureContext()
    if (!ctx) return
    try {
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      this.entries.set(id, { stream, source, analyser, buffer: new Uint8Array(analyser.fftSize) })
    } catch {
      /* stream may already be ended */
    }
  }

  /** Normalized 0..1 RMS levels keyed by participant id. */
  readLevels(): Map<string, number> {
    const out = new Map<string, number>()
    for (const [id, entry] of this.entries) {
      const tracks = entry.stream.getAudioTracks()
      if (tracks.length === 0 || tracks.every((t) => !t.enabled)) {
        out.set(id, 0)
        continue
      }
      try {
        entry.analyser.getByteTimeDomainData(entry.buffer)
      } catch {
        out.set(id, 0)
        continue
      }
      let sum = 0
      for (let i = 0; i < entry.buffer.length; i++) {
        const v = (entry.buffer[i]! - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / entry.buffer.length)
      out.set(id, Math.min(1, rms * 3.2))
    }
    return out
  }

  dispose() {
    for (const entry of this.entries.values()) {
      try {
        entry.source.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.entries.clear()
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }
}
