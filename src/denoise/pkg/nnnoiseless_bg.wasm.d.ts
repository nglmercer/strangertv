/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_denoiser_free: (a: number, b: number) => void;
export const activeIsa: () => [number, number];
export const denoiseBuffer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
export const denoiser_activeIsa: (a: number) => [number, number];
export const denoiser_frameSize: (a: number) => number;
export const denoiser_latencySamples: (a: number) => number;
export const denoiser_new: () => number;
export const denoiser_push: (a: number, b: number, c: number) => [number, number];
export const denoiser_reset: (a: number) => void;
export const denoiser_setAttenuationLimitDb: (a: number, b: number) => void;
export const denoiser_setVadThreshold: (a: number, b: number) => void;
export const denoiser_vad: (a: number) => number;
export const denoiser_withSettings: (a: number, b: number, c: number) => number;
export const version: () => [number, number];
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_start: () => void;
