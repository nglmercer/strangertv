#!/usr/bin/env bash
# Build the nnnoiseless RNNoise denoiser to WebAssembly for the browser live path.
#
# Produces two wasm-pack outputs from the same crate (byte-identical .wasm, different JS glue):
#   src/denoise/pkg/          (--target web)        used by scripts/smoke-denoiser.mjs in Node
#   src/denoise/pkg-worklet/  (--target no-modules) concatenated with the AudioWorklet
#                             processor at runtime (a worklet has no fetch, so the main
#                             thread compiles the wasm and hands over the Module instead)
#
# Idempotent: skips the rebuild when the stamp matches the pinned revision.
set -euo pipefail

cd "$(dirname "$0")/.."

PINNED_REV="2a1ea16e1429d71b553f0b084cd6e14694d197d1"
VENDOR_DIR="vendor/nnnoiseless"
OUT_WEB="src/denoise/pkg"
OUT_WORKLET="src/denoise/pkg-worklet"
STAMP="src/denoise/.wasm-stamp"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$PINNED_REV" ] \
  && [ -f "$OUT_WEB/nnnoiseless_bg.wasm" ] && [ -f "$OUT_WORKLET/nnnoiseless.js" ]; then
  echo "denoiser wasm up to date ($PINNED_REV)"
  exit 0
fi

if ! command -v wasm-pack >/dev/null; then
  echo "error: wasm-pack is required (cargo install wasm-pack) — the mic noise-reduction" >&2
  echo "build needs it. Install it and re-run, or run 'npm run build' after installing." >&2
  exit 1
fi

if [ ! -d "$VENDOR_DIR/.git" ]; then
  echo "vendoring nnnoiseless @ $PINNED_REV ..."
  rm -rf "$VENDOR_DIR"
  git clone https://github.com/nglmercer/nnnoiseless "$VENDOR_DIR"
  git -C "$VENDOR_DIR" checkout --quiet "$PINNED_REV"
else
  git -C "$VENDOR_DIR" fetch --quiet --depth 1 origin "$PINNED_REV" 2>/dev/null || true
  git -C "$VENDOR_DIR" checkout --quiet "$PINNED_REV"
fi

echo "building denoiser wasm (web target) ..."
(cd "$VENDOR_DIR" && RUSTFLAGS="-C target-feature=+simd128" wasm-pack build \
  --target web --out-dir "../../$OUT_WEB" --no-default-features --features wasm)

echo "building denoiser wasm (no-modules target for the AudioWorklet) ..."
(cd "$VENDOR_DIR" && RUSTFLAGS="-C target-feature=+simd128" wasm-pack build \
  --target no-modules --out-dir "../../$OUT_WORKLET" --no-default-features --features wasm)

echo "$PINNED_REV" > "$STAMP"
# wasm-pack writes a `*` .gitignore into each out-dir; the built outputs are
# committed on purpose (builds must work without a Rust WASM toolchain).
rm -f "$OUT_WEB/.gitignore" "$OUT_WORKLET/.gitignore"
ls -la "$OUT_WEB/nnnoiseless_bg.wasm" "$OUT_WORKLET/nnnoiseless_bg.wasm"
echo "denoiser wasm ready"
