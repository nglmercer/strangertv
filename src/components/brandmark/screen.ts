export type ScreenFit = 'stretch' | 'contain' | 'cover'

export interface PushFrameOptions {
  fit?: ScreenFit
  clear?: boolean
}

export interface ScreenRenderFrame {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  width: number
  height: number
  time: number
  delta: number
}

export type ScreenRenderer = (frame: ScreenRenderFrame) => void

export interface DeviceScreenAPI {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
  invalidate(): void
  clear(): void
  pushFrame(source: CanvasImageSource, options?: PushFrameOptions): void
  setRenderer(renderer: ScreenRenderer | null): void
  getRenderer(): ScreenRenderer | null
  resize(width: number, height: number): void
}

export interface DeviceScreenController extends DeviceScreenAPI {
  renderFrame(time: number, delta: number, animate: boolean): boolean
  isDirty(): boolean
  markUploaded(): void
}

export interface CreateDeviceScreenOptions {
  width?: number
  height?: number
  onInvalidate?: () => void
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  const dimensions = source as CanvasImageSource & {
    videoWidth?: number
    videoHeight?: number
    naturalWidth?: number
    naturalHeight?: number
    width?: number | SVGAnimatedLength
    height?: number | SVGAnimatedLength
  }
  const value = (dimension: number | SVGAnimatedLength | undefined): number =>
    typeof dimension === 'number' ? dimension : dimension?.baseVal.value ?? 0
  return {
    width: dimensions.videoWidth || dimensions.naturalWidth || value(dimensions.width),
    height: dimensions.videoHeight || dimensions.naturalHeight || value(dimensions.height),
  }
}

export function createDeviceScreen(options: CreateDeviceScreenOptions = {}): DeviceScreenController {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The device screen requires a 2D canvas context')

  canvas.width = Math.max(1, Math.round(options.width ?? 512))
  canvas.height = Math.max(1, Math.round(options.height ?? canvas.width))

  let renderer: ScreenRenderer | null = null
  let dirty = true
  let rendererNeedsFrame = false

  const invalidate = () => {
    dirty = true
    options.onInvalidate?.()
  }

  const api: DeviceScreenController = {
    canvas,
    context,
    get width() {
      return canvas.width
    },
    get height() {
      return canvas.height
    },
    invalidate,
    clear() {
      context.save()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#050607'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.restore()
      invalidate()
    },
    pushFrame(source, pushOptions = {}) {
      const fit = pushOptions.fit ?? 'stretch'
      const shouldClear = pushOptions.clear ?? true
      const sourceDimensions = sourceSize(source)
      if (sourceDimensions.width <= 0 || sourceDimensions.height <= 0) return

      if (shouldClear) {
        context.fillStyle = '#050607'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }

      if (fit === 'stretch') {
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
      } else {
        const scale = fit === 'contain'
          ? Math.min(canvas.width / sourceDimensions.width, canvas.height / sourceDimensions.height)
          : Math.max(canvas.width / sourceDimensions.width, canvas.height / sourceDimensions.height)
        const width = sourceDimensions.width * scale
        const height = sourceDimensions.height * scale
        context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      }
      invalidate()
    },
    setRenderer(nextRenderer) {
      renderer = nextRenderer
      rendererNeedsFrame = nextRenderer !== null
      if (nextRenderer === null) invalidate()
      options.onInvalidate?.()
    },
    getRenderer() {
      return renderer
    },
    resize(width, height) {
      const nextWidth = Math.max(1, Math.round(width))
      const nextHeight = Math.max(1, Math.round(height))
      if (nextWidth === canvas.width && nextHeight === canvas.height) return
      canvas.width = nextWidth
      canvas.height = nextHeight
      rendererNeedsFrame = renderer !== null
      invalidate()
    },
    renderFrame(time, delta, animate) {
      if (!renderer || (!animate && !rendererNeedsFrame)) return false
      renderer({ ctx: context, canvas, width: canvas.width, height: canvas.height, time, delta })
      rendererNeedsFrame = false
      invalidate()
      return true
    },
    isDirty() {
      return dirty
    },
    markUploaded() {
      dirty = false
    },
  }

  api.clear()
  return api
}

export function createBasicScreenEffect(): ScreenRenderer {
  return ({ ctx, width, height, time }) => {
    const centerX = width * 0.5
    const centerY = height * 0.5
    const unit = Math.min(width, height)
    const pulse = (Math.sin(time * 2.2) + 1) * 0.5

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#050607'
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.strokeStyle = 'rgba(255, 106, 25, 0.055)'
    ctx.lineWidth = 1
    const grid = unit / 12
    for (let x = grid; x < width; x += grid) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = grid; y < height; y += grid) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, unit * 0.24)
    glow.addColorStop(0, 'rgba(255, 92, 20, 0.22)')
    glow.addColorStop(1, 'rgba(255, 92, 20, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = `rgba(255, 106, 25, ${0.23 + pulse * 0.16})`
    ctx.lineWidth = Math.max(1.5, unit * 0.004)
    for (let ring = 0; ring < 2; ring += 1) {
      ctx.beginPath()
      ctx.arc(centerX, centerY, unit * (0.105 + ring * 0.065 + pulse * 0.012), 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.strokeStyle = '#ff6a19'
    ctx.lineWidth = Math.max(3, unit * 0.009)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(centerX, centerY, unit * 0.19, time * 1.1, time * 1.1 + Math.PI * 0.72)
    ctx.stroke()

    ctx.shadowColor = '#ff5a12'
    ctx.shadowBlur = unit * 0.055
    ctx.fillStyle = '#ff6a19'
    ctx.beginPath()
    ctx.arc(centerX, centerY, unit * (0.025 + pulse * 0.004), 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.strokeStyle = 'rgba(255, 122, 45, 0.42)'
    ctx.lineWidth = Math.max(1, unit * 0.0025)
    const mark = unit * 0.045
    const inset = unit * 0.08
    for (const [x, y, sx, sy] of [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ] as const) {
      ctx.beginPath()
      ctx.moveTo(x + sx * mark, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + sy * mark)
      ctx.stroke()
    }
    ctx.restore()
  }
}
