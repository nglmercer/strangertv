import { useEffect, useRef, useCallback } from 'preact/hooks';

interface StaticNoiseProps {
  opacity?: number;
  density?: number;
  cellSize?: number;
  speed?: number;           // 1 = normal, higher = slower
  colorNoise?: boolean;     // subtle color variation
  scanlineIntensity?: number;
}

export function StaticNoise({
  opacity = 0.5,
  density = 0.55,
  cellSize = 3,
  speed = 1,
  colorNoise = false,
  scanlineIntensity = 0.15,
}: StaticNoiseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const runningRef = useRef(true);

  const draw = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const threshold = 1 - density;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (Math.random() > threshold) {
          const v = (Math.random() * 255) | 0;
          const r = colorNoise ? (v * (0.95 + Math.random() * 0.1)) | 0 : v;
          const g = colorNoise ? (v * (0.95 + Math.random() * 0.1)) | 0 : v;
          const b = colorNoise ? (v * (0.95 + Math.random() * 0.1)) | 0 : v;

          const startX = x * cellSize;
          const startY = y * cellSize;

          for (let dy = 0; dy < cellSize; dy++) {
            for (let dx = 0; dx < cellSize; dx++) {
              const idx = ((startY + dy) * width + (startX + dx)) * 4;
              if (idx + 3 < data.length) {
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
              }
            }
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Enhanced CRT scanline + vignette effect
    ctx.fillStyle = `rgba(0,0,0,${scanlineIntensity + Math.random() * 0.05})`;
    ctx.fillRect(0, 0, width, height);

    // Optional subtle horizontal scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < height; i += 4) {
      ctx.fillRect(0, i, width, 1);
    }
  }, [cellSize, density, colorNoise, scanlineIntensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let lastFrame = 0;
    const targetFPS = Math.floor(60 / Math.max(1, speed));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const loop = (timestamp: number) => {
      if (!runningRef.current) return;

      if (timestamp - lastFrame > 1000 / targetFPS) {
        draw(ctx, width, height);
        lastFrame = timestamp;
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    const start = () => {
      runningRef.current = true;
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(loop);
      }
    };

    const stop = () => {
      runningRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
    };

    const onVisibilityChange = () => {
      document.hidden ? stop() : start();
    };

    resize();
    start();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [draw, speed]);

  return (
    <canvas
      ref={canvasRef}
      className="static-noise"
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}
