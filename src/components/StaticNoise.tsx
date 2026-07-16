import { useEffect, useRef } from 'preact/hooks'

export function StaticNoise({
  opacity = 0.5,
  density = 0.55,
  cellSize = 3,
}: {
  opacity?: number
  density?: number
  cellSize?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let raf = 0
    let running = true
    let width = 0
    let height = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = () => {
      if (!running) return
      const cols = Math.ceil(width / cellSize)
      const rows = Math.ceil(height / cellSize)

      ctx.clearRect(0, 0, width, height)

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (Math.random() > density) continue
          const v = (Math.random() * 255) | 0
          ctx.fillStyle = `rgb(${v},${v},${v})`
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
        }
      }

      // Subtle scanline flicker for that "CRT" feel
      ctx.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.06})`
      ctx.fillRect(0, 0, width, height)

      raf = requestAnimationFrame(draw)
    }

    const start = () => {
      if (!running) {
        running = true
        raf = requestAnimationFrame(draw)
      }
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    const onVisibility = () => (document.hidden ? stop() : start())

    resize()
    raf = requestAnimationFrame(draw)

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [density, cellSize])

  return (
    <canvas
      ref={canvasRef}
      class="static-noise"
      style={{ opacity }}
      aria-hidden="true"
    />
  )
}
