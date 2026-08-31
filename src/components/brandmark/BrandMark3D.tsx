import { useEffect, useRef } from 'preact/hooks'
import type { DeviceConfig } from './deviceConfig'
import { createDeviceRenderer, type DeviceRendererAPI } from './renderer'
import { createBasicScreenEffect } from './screen'

export interface BrandMark3DProps {
  autoSpin?: boolean
  interactive?: boolean
  defaultScreenEffect?: boolean
  screenResolution?: number
  config?: DeviceConfig
  className?: string
  onReady?: (api: DeviceRendererAPI) => void
}

export function BrandMark3D({
  autoSpin = true,
  interactive = true,
  defaultScreenEffect = true,
  screenResolution,
  config,
  className = '',
  onReady,
}: BrandMark3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: DeviceRendererAPI | null = null
    try {
      renderer = createDeviceRenderer(canvas, {
        autoSpin,
        interactive,
        screenResolution,
        config,
      })
      if (defaultScreenEffect) renderer.screen.setRenderer(createBasicScreenEffect())
      onReadyRef.current?.(renderer)
    } catch (error) {
      console.error('Unable to initialize the 3D device', error)
    }

    return () => renderer?.destroy()
  }, [autoSpin, interactive, defaultScreenEffect, screenResolution, config])

  return (
    <canvas
      ref={canvasRef}
      class={`brand-mark-3d ${className}`.trim()}
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        touchAction: interactive ? 'none' : 'auto',
      }}
    />
  )
}
