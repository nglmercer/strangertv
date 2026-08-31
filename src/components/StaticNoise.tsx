import { useEffect, useRef, useCallback } from 'preact/hooks';

interface StaticNoiseProps {
  opacity?: number;
  density?: number;
  cellSize?: number;
  speed?: number;
  colorNoise?: boolean;
  scanlineIntensity?: number;

  // Extra analog effects
  flicker?: number;
  vignette?: number;
  interference?: number;
  tearChance?: number;
}

export function StaticNoise({
  opacity = 0.45,
  density = 0.75,
  cellSize = 2,
  speed = 1,
  colorNoise = false,
  scanlineIntensity = 0.12,
  flicker = 0.06,
  vignette = 0.45,
  interference = 0.12,
  tearChance = 0.015,
}: StaticNoiseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const runningRef = useRef(false);

  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      noiseCanvas: HTMLCanvasElement,
      noiseCtx: CanvasRenderingContext2D,
      width: number,
      height: number,
      time: number
    ) => {
      const scale = Math.max(1, cellSize);

      const noiseWidth = Math.max(1, Math.ceil(width / scale));
      const noiseHeight = Math.max(1, Math.ceil(height / scale));

      // Resize tiny offscreen noise buffer only when necessary.
      if (
        noiseCanvas.width !== noiseWidth ||
        noiseCanvas.height !== noiseHeight
      ) {
        noiseCanvas.width = noiseWidth;
        noiseCanvas.height = noiseHeight;
      }

      const image = noiseCtx.createImageData(noiseWidth, noiseHeight);
      const data = image.data;

      /*
       * Mostly random noise, but with a subtle temporal component.
       * Pure Math.random() every frame tends to look unnaturally digital.
       */
      const temporalWave =
        Math.sin(time * 0.0023) * 10 +
        Math.sin(time * 0.00071) * 7;

      for (let i = 0; i < data.length; i += 4) {
        const active = Math.random() < density;

        if (!active) {
          data[i + 3] = 0;
          continue;
        }

        let value =
          35 +
          Math.random() * 190 +
          temporalWave +
          (Math.random() - 0.5) * 30;

        value = Math.max(0, Math.min(255, value));

        if (colorNoise) {
          const chroma = 10;

          data[i] = Math.max(
            0,
            Math.min(255, value + (Math.random() - 0.5) * chroma)
          );

          data[i + 1] = Math.max(
            0,
            Math.min(255, value + (Math.random() - 0.5) * chroma)
          );

          data[i + 2] = Math.max(
            0,
            Math.min(255, value + (Math.random() - 0.5) * chroma)
          );
        } else {
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
        }

        data[i + 3] = 255;
      }

      noiseCtx.putImageData(image, 0, 0);

      ctx.clearRect(0, 0, width, height);

      ctx.save();

      // Keep the chunky pixels crisp.
      ctx.imageSmoothingEnabled = false;

      /*
       * Tiny horizontal jitter gives the signal a more unstable analog feel.
       */
      const jitter =
        Math.random() < 0.08
          ? Math.round((Math.random() - 0.5) * 4)
          : 0;

      ctx.drawImage(
        noiseCanvas,
        0,
        0,
        noiseWidth,
        noiseHeight,
        jitter,
        0,
        width,
        height
      );

      ctx.restore();

      // ------------------------------------------------------------
      // Rolling interference band
      // ------------------------------------------------------------

      if (interference > 0) {
        const bandPosition =
          ((time * 0.045) % (height + 300)) - 150;

        const bandHeight = Math.max(80, height * 0.15);

        const gradient = ctx.createLinearGradient(
          0,
          bandPosition - bandHeight,
          0,
          bandPosition + bandHeight
        );

        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(
          0.5,
          `rgba(255,255,255,${interference})`
        );
        gradient.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(
          0,
          bandPosition - bandHeight,
          width,
          bandHeight * 2
        );
      }

      // ------------------------------------------------------------
      // Horizontal signal tear
      // ------------------------------------------------------------

      if (Math.random() < tearChance) {
        const y = Math.floor(Math.random() * height);
        const tearHeight = 2 + Math.floor(Math.random() * 12);
        const offset = Math.round((Math.random() - 0.5) * 30);

        ctx.drawImage(
          canvasRef.current!,
          0,
          y,
          width,
          tearHeight,
          offset,
          y,
          width,
          tearHeight
        );
      }

      // ------------------------------------------------------------
      // CRT scanlines
      // ------------------------------------------------------------

      if (scanlineIntensity > 0) {
        ctx.fillStyle = `rgba(0,0,0,${scanlineIntensity})`;

        // Alternating dark lines feel less like a CSS stripe pattern.
        for (let y = 1; y < height; y += 3) {
          ctx.fillRect(0, y, width, 1);
        }

        // Very subtle bright phosphor line.
        ctx.fillStyle = `rgba(255,255,255,${
          scanlineIntensity * 0.12
        })`;

        for (let y = 0; y < height; y += 3) {
          ctx.fillRect(0, y, width, 1);
        }
      }

      // ------------------------------------------------------------
      // Random CRT brightness flicker
      // ------------------------------------------------------------

      if (flicker > 0) {
        const flickerAmount =
          Math.random() * flicker +
          Math.sin(time * 0.035) * flicker * 0.15;

        ctx.fillStyle =
          flickerAmount >= 0
            ? `rgba(255,255,255,${Math.abs(flickerAmount)})`
            : `rgba(0,0,0,${Math.abs(flickerAmount)})`;

        ctx.fillRect(0, 0, width, height);
      }

      // ------------------------------------------------------------
      // Vignette
      // ------------------------------------------------------------

      if (vignette > 0) {
        const vignetteGradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.15,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.72
        );

        vignetteGradient.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGradient.addColorStop(
          0.72,
          `rgba(0,0,0,${vignette * 0.15})`
        );
        vignetteGradient.addColorStop(
          1,
          `rgba(0,0,0,${vignette})`
        );

        ctx.fillStyle = vignetteGradient;
        ctx.fillRect(0, 0, width, height);
      }
    },
    [
      cellSize,
      colorNoise,
      density,
      flicker,
      interference,
      scanlineIntensity,
      tearChance,
      vignette,
    ]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', {
      alpha: true,
    });

    if (!ctx) return;

    // Small offscreen buffer containing the raw static.
    const noiseCanvas = document.createElement('canvas');
    const noiseCtx = noiseCanvas.getContext('2d');

    if (!noiseCtx) return;

    let width = 1;
    let height = 1;
    let lastFrame = 0;

    // speed = 1 -> 60fps
    // speed = 2 -> 30fps
    // speed = 3 -> 20fps
    const targetFPS = Math.max(
      8,
      60 / Math.max(1, speed)
    );

    const frameDuration = 1000 / targetFPS;

    const resize = () => {
      const parent = canvas.parentElement;

      const rect = parent
        ? parent.getBoundingClientRect()
        : canvas.getBoundingClientRect();

      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));

      if (
        canvas.width !== width ||
        canvas.height !== height
      ) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const loop = (time: number) => {
      if (!runningRef.current) return;

      if (time - lastFrame >= frameDuration) {
        draw(
          ctx,
          noiseCanvas,
          noiseCtx,
          width,
          height,
          time
        );

        // Prevent accumulated timing drift.
        lastFrame =
          time - ((time - lastFrame) % frameDuration);
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    const start = () => {
      if (runningRef.current) return;

      runningRef.current = true;
      lastFrame = performance.now();

      animationRef.current =
        requestAnimationFrame(loop);
    };

    const stop = () => {
      runningRef.current = false;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    } else {
      resizeObserver.observe(canvas);
    }

    document.addEventListener(
      'visibilitychange',
      onVisibilityChange
    );

    start();

    return () => {
      stop();
      resizeObserver.disconnect();

      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      );
    };
  }, [draw, speed]);

  return (
    <canvas
      ref={canvasRef}
      className="static-noise"
      style={{
        opacity,
        pointerEvents: 'none',
        width: '100%',
        height: '100%',
      }}
      aria-hidden="true"
    />
  );
}
