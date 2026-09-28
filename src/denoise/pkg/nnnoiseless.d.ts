/* tslint:disable */
/* eslint-disable */

/**
 * Streaming denoiser for live audio.
 *
 * Push whatever block size the audio graph hands you; pull back whatever is ready. Output
 * lags input by one 10ms frame plus any lookahead, so the first call or two return fewer
 * samples than they were given.
 *
 * ```js
 * const denoiser = new Denoiser();
 * denoiser.setAttenuationLimitDb(12);
 * const out = denoiser.push(inputBlock); // Float32Array, may be shorter than the input
 * ```
 */
export class Denoiser {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a denoiser for 48kHz mono audio.
     *
     * Ask for a 48kHz `AudioContext` (`new AudioContext({ sampleRate: 48000 })`) so that no
     * resampling is needed in the live path.
     */
    constructor();
    /**
     * Feeds samples in and returns whatever output is ready.
     *
     * The returned array is usually the same length as the input, but is shorter while the
     * denoiser is filling its delay line.
     */
    push(input: Float32Array): Float32Array;
    /**
     * Forgets all history.
     */
    reset(): void;
    /**
     * Caps how far any band may be attenuated. `0` removes the cap.
     */
    setAttenuationLimitDb(db: number): void;
    /**
     * Gates frames whose speech probability is below `threshold`. `0` disables gating.
     */
    setVadThreshold(threshold: number): void;
    /**
     * Creates a denoiser with the tuning knobs set up front.
     *
     * `attenuation_limit_db` of `0` means unlimited suppression; `vad_threshold` of `0`
     * disables gating.
     */
    static withSettings(attenuation_limit_db: number, vad_threshold: number, lookahead: number): Denoiser;
    /**
     * The instruction set the kernels were compiled for, as a string.
     */
    readonly activeIsa: string;
    /**
     * The number of samples in one processing frame (480, i.e. 10ms at 48kHz).
     */
    readonly frameSize: number;
    /**
     * How many samples of delay this configuration introduces.
     */
    readonly latencySamples: number;
    /**
     * Probability that the most recently emitted frame contained speech, in `0..=1`.
     */
    readonly vad: number;
}

/**
 * The instruction set the kernels were compiled for.
 */
export function activeIsa(): string;

/**
 * Denoises a complete buffer, resampling to 48kHz and back if necessary.
 *
 * This is the one to use for a decoded `AudioBuffer`: it returns a buffer the same length as
 * the input, at the same sample rate, with the algorithm's latency already compensated for.
 *
 * `attenuation_limit_db` of `0` means unlimited suppression; `vad_threshold` of `0` disables
 * gating.
 */
export function denoiseBuffer(samples: Float32Array, sample_rate: number, attenuation_limit_db: number, vad_threshold: number, lookahead: number): Float32Array;

/**
 * The crate version, so a page can show what it is running.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_denoiser_free: (a: number, b: number) => void;
    readonly activeIsa: () => [number, number];
    readonly denoiseBuffer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly denoiser_activeIsa: (a: number) => [number, number];
    readonly denoiser_frameSize: (a: number) => number;
    readonly denoiser_latencySamples: (a: number) => number;
    readonly denoiser_new: () => number;
    readonly denoiser_push: (a: number, b: number, c: number) => [number, number];
    readonly denoiser_reset: (a: number) => void;
    readonly denoiser_setAttenuationLimitDb: (a: number, b: number) => void;
    readonly denoiser_setVadThreshold: (a: number, b: number) => void;
    readonly denoiser_vad: (a: number) => number;
    readonly denoiser_withSettings: (a: number, b: number, c: number) => number;
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
