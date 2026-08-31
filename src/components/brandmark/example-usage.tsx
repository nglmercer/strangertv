import { useEffect, useRef } from 'preact/hooks'
import { BrandMark3D, type DeviceRendererAPI } from './index'

export function ExternalCanvasDeviceExample() {
  const deviceRef = useRef<DeviceRendererAPI | null>(null)
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const contentCanvas = document.createElement('canvas')
    contentCanvas.width = 512
    contentCanvas.height = 512
    frameCanvasRef.current = contentCanvas
    const ctx = contentCanvas.getContext('2d')
    if (!ctx) return

    let animationFrame = 0
    const draw = (timestamp: number) => {
      const time = timestamp / 1000
      ctx.fillStyle = '#050607'
      ctx.fillRect(0, 0, contentCanvas.width, contentCanvas.height)
      ctx.fillStyle = '#ff641c'
      ctx.font = '700 42px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('HELLO AI', 256, 218)
      ctx.beginPath()
      ctx.arc(256 + Math.sin(time * 2) * 72, 300, 15, 0, Math.PI * 2)
      ctx.fill()

      deviceRef.current?.screen.pushFrame(contentCanvas, { fit: 'cover' })
      animationFrame = requestAnimationFrame(draw)
    }
    animationFrame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationFrame)
      frameCanvasRef.current = null
      deviceRef.current = null
    }
  }, [])

  return (
    <div style={{ width: '600px', height: '600px', maxWidth: '100%' }}>
      <BrandMark3D
        autoSpin
        interactive
        defaultScreenEffect={false}
        onReady={(device) => {
          deviceRef.current = device
          device.screen.setRenderer(null)
          if (frameCanvasRef.current) {
            device.screen.pushFrame(frameCanvasRef.current, { fit: 'cover' })
          }
        }}
      />
    </div>
  )
}
