// AudioWorklet processor for the live-mic RNNoise denoiser.
//
// Adapted from the nnnoiseless browser demo's denoise-worklet.ts
// (https://github.com/nglmercer/nnnoiseless, BSD-3-Clause), reduced to the
// RNNoise backend. Plain JavaScript on purpose: it is loaded with `?raw` and
// concatenated with the wasm-bindgen `no-modules` glue into a blob URL (an
// AudioWorkletGlobalScope has no `fetch`, so it cannot load the wasm by URL
// itself — the main thread compiles the module and hands it over instead).
//
// The `wasm_bindgen` global below comes from that prepended glue.

/* global wasm_bindgen, registerProcessor, AudioWorkletProcessor, sampleRate */

const wasm = wasm_bindgen

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.denoiser = null
    this.bypass = false

    this.port.onmessage = (event) => {
      const msg = event.data
      try {
        switch (msg.type) {
          case 'init': {
            wasm.initSync({ module: msg.module })
            this.denoiser = wasm.Denoiser.withSettings(
              msg.attenuationDb ?? 0,
              msg.vadThreshold ?? 0,
              0, // lookahead adds latency; keep the live path as tight as possible
            )
            this.port.postMessage({
              type: 'ready',
              latencySamples: this.denoiser ? this.denoiser.latencySamples : 0,
              sampleRate,
            })
            break
          }
          case 'bypass':
            this.bypass = Boolean(msg.value)
            break
          case 'attenuation':
            if (this.denoiser) this.denoiser.setAttenuationLimitDb(msg.value)
            break
          case 'vadThreshold':
            if (this.denoiser) this.denoiser.setVadThreshold(msg.value)
            break
          case 'reset':
            if (this.denoiser) this.denoiser.reset()
            break
          default:
            break
        }
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err) })
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const outChannel = output[0]
    const inChannel = input && input.length > 0 ? input[0] : null

    // No input connected yet: emit silence but keep the node alive.
    if (!inChannel) {
      outChannel.fill(0)
      return true
    }

    if (!this.denoiser || this.bypass) {
      outChannel.set(inChannel)
      return true
    }

    // `push` buffers internally: it accepts the worklet's 128-sample blocks
    // even though the algorithm works in 480-sample frames, and returns at
    // most as many samples as it was given. It returns fewer only while
    // filling its delay line, which is why the tail is zeroed.
    const denoised = this.denoiser.push(inChannel)
    if (denoised.length < outChannel.length) {
      outChannel.fill(0)
    }
    outChannel.set(denoised.subarray(0, outChannel.length))
    return true
  }
}

registerProcessor('stranger-denoiser', DenoiseProcessor)
