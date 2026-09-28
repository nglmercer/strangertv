/* @ts-self-types="./nnnoiseless.d.ts" */

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
    static __wrap(ptr) {
        const obj = Object.create(Denoiser.prototype);
        obj.__wbg_ptr = ptr;
        DenoiserFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DenoiserFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_denoiser_free(ptr, 0);
    }
    /**
     * The instruction set the kernels were compiled for, as a string.
     * @returns {string}
     */
    get activeIsa() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.denoiser_activeIsa(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The number of samples in one processing frame (480, i.e. 10ms at 48kHz).
     * @returns {number}
     */
    get frameSize() {
        const ret = wasm.denoiser_frameSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * How many samples of delay this configuration introduces.
     * @returns {number}
     */
    get latencySamples() {
        const ret = wasm.denoiser_latencySamples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Creates a denoiser for 48kHz mono audio.
     *
     * Ask for a 48kHz `AudioContext` (`new AudioContext({ sampleRate: 48000 })`) so that no
     * resampling is needed in the live path.
     */
    constructor() {
        const ret = wasm.denoiser_new();
        this.__wbg_ptr = ret;
        DenoiserFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Feeds samples in and returns whatever output is ready.
     *
     * The returned array is usually the same length as the input, but is shorter while the
     * denoiser is filling its delay line.
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    push(input) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.denoiser_push(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Forgets all history.
     */
    reset() {
        wasm.denoiser_reset(this.__wbg_ptr);
    }
    /**
     * Caps how far any band may be attenuated. `0` removes the cap.
     * @param {number} db
     */
    setAttenuationLimitDb(db) {
        wasm.denoiser_setAttenuationLimitDb(this.__wbg_ptr, db);
    }
    /**
     * Gates frames whose speech probability is below `threshold`. `0` disables gating.
     * @param {number} threshold
     */
    setVadThreshold(threshold) {
        wasm.denoiser_setVadThreshold(this.__wbg_ptr, threshold);
    }
    /**
     * Probability that the most recently emitted frame contained speech, in `0..=1`.
     * @returns {number}
     */
    get vad() {
        const ret = wasm.denoiser_vad(this.__wbg_ptr);
        return ret;
    }
    /**
     * Creates a denoiser with the tuning knobs set up front.
     *
     * `attenuation_limit_db` of `0` means unlimited suppression; `vad_threshold` of `0`
     * disables gating.
     * @param {number} attenuation_limit_db
     * @param {number} vad_threshold
     * @param {number} lookahead
     * @returns {Denoiser}
     */
    static withSettings(attenuation_limit_db, vad_threshold, lookahead) {
        const ret = wasm.denoiser_withSettings(attenuation_limit_db, vad_threshold, lookahead);
        return Denoiser.__wrap(ret);
    }
}
if (Symbol.dispose) Denoiser.prototype[Symbol.dispose] = Denoiser.prototype.free;

/**
 * The instruction set the kernels were compiled for.
 * @returns {string}
 */
export function activeIsa() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.activeIsa();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Denoises a complete buffer, resampling to 48kHz and back if necessary.
 *
 * This is the one to use for a decoded `AudioBuffer`: it returns a buffer the same length as
 * the input, at the same sample rate, with the algorithm's latency already compensated for.
 *
 * `attenuation_limit_db` of `0` means unlimited suppression; `vad_threshold` of `0` disables
 * gating.
 * @param {Float32Array} samples
 * @param {number} sample_rate
 * @param {number} attenuation_limit_db
 * @param {number} vad_threshold
 * @param {number} lookahead
 * @returns {Float32Array}
 */
export function denoiseBuffer(samples, sample_rate, attenuation_limit_db, vad_threshold, lookahead) {
    const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.denoiseBuffer(ptr0, len0, sample_rate, attenuation_limit_db, vad_threshold, lookahead);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * The crate version, so a page can show what it is running.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./nnnoiseless_bg.js": import0,
    };
}

const DenoiserFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_denoiser_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('nnnoiseless_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
