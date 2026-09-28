/**
 * Live-microphone noise reduction (RNNoise via nnnoiseless WebAssembly).
 *
 * Topology: mic track -> MediaStreamSource -> AudioWorklet(Denoiser) ->
 * MediaStreamDestination -> denoised track, which is what gets published to
 * the peer connections. Follows the nnnoiseless browser demo's loading
 * protocol (https://github.com/nglmercer/nnnoiseless): the wasm-bindgen
 * `no-modules` glue plus the processor source are concatenated into a blob
 * for `addModule` (a worklet cannot fetch), while the main thread compiles
 * the wasm and hands the `WebAssembly.Module` over by postMessage.
 *
 * Everything here degrades to "denoiser unavailable": callers must treat a
 * rejection from `attach()` as "publish the raw mic" and keep the call alive.
 */

/** Sample rate the RNNoise path requires. No resampling in the live path. */
export const DENOISER_SAMPLE_RATE = 48_000

/** Gentle default: leaves a noise floor instead of gating to silence. */
export const DEFAULT_ATTENUATION_DB = 12

const PROCESSOR_NAME = 'stranger-denoiser'
const INIT_TIMEOUT_MS = 10_000

// Some browsers expose a smaller global inside AudioWorkletGlobalScope and do
// not provide TextDecoder there. wasm-bindgen's no-modules glue uses it while
// the worklet module is being evaluated, so provide a small UTF-8 fallback.
// (Copied from the nnnoiseless web demo, BSD-3-Clause.)
const WORKLET_TEXT_DECODER = `
const TextDecoder = globalThis.TextDecoder || class TextDecoder {
  decode(input = new Uint8Array()) {
    let text = '';
    for (let i = 0; i < input.length;) {
      const first = input[i++];
      let codePoint;
      let length;
      if (first < 0x80) {
        codePoint = first;
      } else if ((first & 0xe0) === 0xc0) {
        codePoint = first & 0x1f;
        length = 1;
      } else if ((first & 0xf0) === 0xe0) {
        codePoint = first & 0x0f;
        length = 2;
      } else if ((first & 0xf8) === 0xf0) {
        codePoint = first & 0x07;
        length = 3;
      } else {
        text += '\\ufffd';
        continue;
      }
      if (i + length > input.length) {
        text += '\\ufffd';
        break;
      }
      let valid = true;
      for (let j = 0; j < length; j += 1) {
        const next = input[i++];
        if ((next & 0xc0) !== 0x80) valid = false;
        codePoint = (codePoint << 6) | (next & 0x3f);
      }
      if (
        !valid ||
        (length === 1 && codePoint < 0x80) ||
        (length === 2 && codePoint < 0x800) ||
        (length === 3 && codePoint < 0x10000) ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        text += '\\ufffd';
      } else {
        text += String.fromCodePoint(codePoint);
      }
    }
    return text;
  }
};
`

export type DenoiserStatus = 'idle' | 'loading' | 'ready' | 'failed'

export type DenoiserSettings = {
  attenuationDb: number
  vadThreshold: number
}

/**
 * True when this browser has every API the worklet path needs. Deliberately
 * broad-typed so unit tests can drive it with stubbed globals.
 */
export function isDenoiserSupported(env: {
  AudioContext?: unknown
  MediaStream?: unknown
  WebAssembly?: unknown
} = globalThis as unknown as Record<string, unknown>): boolean {
  if (typeof env.AudioContext !== 'function') return false
  if (typeof env.MediaStream !== 'function') return false
  const wasm = env.WebAssembly as { compile?: unknown } | undefined
  if (!wasm || typeof wasm.compile !== 'function') return false
  // audioWorklet lives on the AudioContext prototype in supporting browsers.
  const proto = (env.AudioContext as { prototype?: { audioWorklet?: unknown } }).prototype
  if (proto && !('audioWorklet' in proto)) return false
  return true
}

/**
 * Mic constraints for Layer 0 (browser-native processing) + Layer 1 handoff.
 *
 * Always asks for echo cancellation and AGC. Browser noise suppression stays
 * on only while the WASM denoiser is off — running both stacks double
 * suppresses and artifacts. Processing keys are ideal (never exact), so an
 * engine that lacks them still opens the mic.
 */
export function buildAudioConstraints(
  audioId: string,
  opts: { deviceIdMode: 'exact' | 'ideal'; denoiseOn: boolean },
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: !opts.denoiseOn,
  }
  if (audioId) {
    constraints.deviceId = opts.deviceIdMode === 'exact' ? { exact: audioId } : { ideal: audioId }
  }
  return constraints
}

type WorkletModule = {
  blobSources: { glue: string; processor: string }
  wasmUrl: string
}

async function loadWorkletModule(): Promise<WorkletModule> {
  // Dynamic imports: the glue/processor/wasm only download when noise
  // reduction is first enabled, never on initial page load.
  const [glueMod, processorMod, wasmMod] = await Promise.all([
    import('./pkg-worklet/nnnoiseless.js?raw'),
    import('./processor.js?raw'),
    import('./pkg-worklet/nnnoiseless_bg.wasm?url'),
  ])
  return {
    blobSources: { glue: glueMod.default as string, processor: processorMod.default as string },
    wasmUrl: wasmMod.default as string,
  }
}

/**
 * Owns one AudioContext + worklet node and re-chains it across mic tracks
 * (device switches) without rebuilding the graph. One instance per session.
 */
export class DenoiserChain {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private inputTrack: MediaStreamTrack | null = null
  private outputTrack: MediaStreamTrack | null = null
  private ready: Promise<void> | null = null
  private settings: DenoiserSettings
  status: DenoiserStatus = 'idle'

  constructor(settings: Partial<DenoiserSettings> = {}) {
    this.settings = {
      attenuationDb: settings.attenuationDb ?? DEFAULT_ATTENUATION_DB,
      vadThreshold: settings.vadThreshold ?? 0,
    }
  }

  get activeInput(): MediaStreamTrack | null {
    return this.inputTrack
  }

  private ensureGraph(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = this.buildGraph().catch((err) => {
      this.status = 'failed'
      this.ready = null
      this.teardownGraph()
      throw err
    })
    return this.ready
  }

  private async buildGraph(): Promise<void> {
    this.status = 'loading'
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('AudioContext unavailable')
    const ctx = new Ctor({ sampleRate: DENOISER_SAMPLE_RATE, latencyHint: 'interactive' })
    this.ctx = ctx
    try {
      // A context running at the wrong rate would feed the model mislabeled
      // audio. Fail loudly (caller falls back to the raw mic) instead.
      if (ctx.sampleRate !== DENOISER_SAMPLE_RATE) {
        throw new Error(`denoiser needs a ${DENOISER_SAMPLE_RATE} Hz AudioContext, got ${ctx.sampleRate} Hz`)
      }
      await ctx.resume().catch(() => undefined)

      const { blobSources, wasmUrl } = await loadWorkletModule()
      const blob = new Blob(
        [WORKLET_TEXT_DECODER, blobSources.glue, '\n', blobSources.processor],
        { type: 'application/javascript' },
      )
      const blobUrl = URL.createObjectURL(blob)
      try {
        await ctx.audioWorklet.addModule(blobUrl)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }

      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      this.node = node
      const destination = ctx.createMediaStreamDestination()
      this.destination = destination
      node.connect(destination)

      const initDone = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('denoiser init timed out')), INIT_TIMEOUT_MS)
        node.port.onmessage = (event: MessageEvent) => {
          const msg = event.data as { type?: string; message?: string }
          if (msg.type === 'ready') {
            window.clearTimeout(timer)
            resolve()
          } else if (msg.type === 'error') {
            window.clearTimeout(timer)
            reject(new Error(msg.message || 'denoiser worklet error'))
          }
        }
      })

      const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer()
      const module = await WebAssembly.compile(wasmBytes)
      node.port.postMessage({
        type: 'init',
        module,
        attenuationDb: this.settings.attenuationDb,
        vadThreshold: this.settings.vadThreshold,
      })
      await initDone
      node.port.onmessage = null
      this.status = 'ready'
    } catch (err) {
      this.teardownGraph()
      throw err
    }
  }

  private teardownGraph() {
    try {
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.node?.disconnect()
    } catch {
      /* ignore */
    }
    this.source = null
    this.node = null
    this.destination = null
    this.inputTrack = null
    this.outputTrack = null
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }

  /**
   * Chain the denoiser onto `track` and return the denoised output track.
   * Rejects when the worklet path is unavailable — publish the raw mic then.
   */
  async attach(track: MediaStreamTrack): Promise<MediaStreamTrack> {
    if (this.inputTrack === track && this.outputTrack?.readyState === 'live') {
      return this.outputTrack
    }
    await this.ensureGraph()
    const ctx = this.ctx
    const node = this.node
    const destination = this.destination
    if (!ctx || !node || !destination) throw new Error('denoiser graph not built')
    // A context built before a user gesture starts suspended and would render
    // silence; resume on every attach (idempotent once running).
    await ctx.resume().catch(() => undefined)

    try {
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    source.connect(node)
    this.source = source
    this.inputTrack = track

    const out = destination.stream.getAudioTracks()[0]
    if (!out) throw new Error('denoiser produced no output track')
    // Mute stays upstream: disabling the raw input silences the graph, so the
    // output track itself always stays enabled.
    out.enabled = true
    this.outputTrack = out
    node.port.postMessage({ type: 'reset' })
    return out
  }

  /** Drop the current input (e.g. its device vanished); the graph stays warm. */
  detach() {
    try {
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.source = null
    this.inputTrack = null
    this.outputTrack = null
  }

  setAttenuationDb(db: number) {
    this.settings.attenuationDb = db
    this.node?.port.postMessage({ type: 'attenuation', value: db })
  }

  setVadThreshold(threshold: number) {
    this.settings.vadThreshold = threshold
    this.node?.port.postMessage({ type: 'vadThreshold', value: threshold })
  }

  /** Full teardown: call on session end / unmount. */
  dispose() {
    this.ready = null
    this.status = 'idle'
    this.teardownGraph()
  }
}
