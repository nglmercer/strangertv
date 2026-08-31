import { DEVICE_CONFIG, type DeviceConfig } from './deviceConfig'
import { makeSmartDevice } from './geometry'
import { multiply, normalMatrix, perspective, rotationX, rotationY, translation } from './math'
import { createDeviceScreen, type DeviceScreenAPI } from './screen'
import { createProgram } from './shaders'

export interface DeviceRendererOptions {
  autoSpin?: boolean
  interactive?: boolean
  screenResolution?: number
  config?: DeviceConfig
}

export interface DeviceRendererAPI {
  readonly canvas: HTMLCanvasElement
  readonly screen: DeviceScreenAPI
  start(): void
  stop(): void
  destroy(): void
  setRotation(x: number, y: number): void
  resetRotation(): void
}

interface Rotation {
  x: number
  y: number
}

const DEFAULT_ROTATION: Rotation = { x: 0.19, y: 0.46 }

function createBuffer(
  gl: WebGLRenderingContext,
  target: number,
  data: BufferSource,
): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('Unable to allocate a WebGL buffer')
  gl.bindBuffer(target, buffer)
  gl.bufferData(target, data, gl.STATIC_DRAW)
  return buffer
}

export function createDeviceRenderer(
  canvas: HTMLCanvasElement,
  options: DeviceRendererOptions = {},
): DeviceRendererAPI {
  const config = options.config ?? DEVICE_CONFIG
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: true,
  })
  if (!gl) throw new Error('WebGL is not available in this browser')

  const { program, vertexShader, fragmentShader } = createProgram(gl)
  const geometry = makeSmartDevice(config)
  const positionBuffer = createBuffer(gl, gl.ARRAY_BUFFER, geometry.positions)
  const normalBuffer = createBuffer(gl, gl.ARRAY_BUFFER, geometry.normals)
  const uvBuffer = createBuffer(gl, gl.ARRAY_BUFFER, geometry.uvs)
  const chassisIndexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geometry.chassisIndices)
  const bezelIndexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geometry.bezelIndices)
  const screenIndexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geometry.screenIndices)
  const buffers = [
    positionBuffer,
    normalBuffer,
    uvBuffer,
    chassisIndexBuffer,
    bezelIndexBuffer,
    screenIndexBuffer,
  ]

  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to allocate the device screen texture')

  const screenResolution = Math.max(1, Math.round(options.screenResolution ?? config.screenResolution))
  const screen = createDeviceScreen({ width: screenResolution, height: screenResolution })

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, screen.canvas)
  screen.markUploaded()
  let textureWidth = screen.width
  let textureHeight = screen.height

  gl.useProgram(program)
  const positionLocation = gl.getAttribLocation(program, 'aPosition')
  const normalLocation = gl.getAttribLocation(program, 'aNormal')
  const uvLocation = gl.getAttribLocation(program, 'aUv')
  const projectionLocation = gl.getUniformLocation(program, 'uProjection')
  const modelViewLocation = gl.getUniformLocation(program, 'uModelView')
  const normalMatrixLocation = gl.getUniformLocation(program, 'uNormalMatrix')
  const chassisColorLocation = gl.getUniformLocation(program, 'uChassisColor')
  const bezelColorLocation = gl.getUniformLocation(program, 'uBezelColor')
  const partLocation = gl.getUniformLocation(program, 'uPart')
  const screenTextureLocation = gl.getUniformLocation(program, 'uScreenTexture')

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer)
  gl.enableVertexAttribArray(normalLocation)
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
  gl.enableVertexAttribArray(uvLocation)
  gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0)

  gl.uniform3fv(chassisColorLocation, config.colors.chassis)
  gl.uniform3fv(bezelColorLocation, config.colors.bezel)
  gl.uniform1i(screenTextureLocation, 0)
  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.CULL_FACE)
  gl.cullFace(gl.BACK)

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reducedMotion = reducedMotionQuery.matches
  let rotation: Rotation = { ...DEFAULT_ROTATION }
  let dragging = false
  let activePointerId: number | null = null
  let lastPointerX = 0
  let lastPointerY = 0
  let animationFrame = 0
  let desiredRunning = true
  let rendering = false
  let destroyed = false
  let previousTime = 0

  const uploadScreen = () => {
    if (!screen.isDirty()) return
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (screen.width !== textureWidth || screen.height !== textureHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, screen.canvas)
      textureWidth = screen.width
      textureHeight = screen.height
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, screen.canvas)
    }
    screen.markUploaded()
  }

  const resizeDrawingBuffer = () => {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
  }

  const drawPart = (part: number, indexBuffer: WebGLBuffer, count: number) => {
    gl.uniform1f(partLocation, part)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0)
  }

  const render = (timestamp: number) => {
    if (!rendering || destroyed) return
    const time = timestamp / 1000
    const delta = previousTime === 0 ? 0 : Math.min(0.05, time - previousTime)
    previousTime = time

    resizeDrawingBuffer()
    if ((options.autoSpin ?? true) && !dragging && !reducedMotion) {
      rotation.y += delta * 0.15
    }
    screen.renderFrame(time, delta, !reducedMotion)
    uploadScreen()

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)

    const projection = perspective((34 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 50)
    let modelView = translation(0, 0, -6.1)
    modelView = multiply(modelView, rotationX(rotation.x))
    modelView = multiply(modelView, rotationY(rotation.y))
    gl.uniformMatrix4fv(projectionLocation, false, projection)
    gl.uniformMatrix4fv(modelViewLocation, false, modelView)
    gl.uniformMatrix3fv(normalMatrixLocation, false, normalMatrix(modelView))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)

    drawPart(0, chassisIndexBuffer, geometry.chassisIndices.length)
    drawPart(2, bezelIndexBuffer, geometry.bezelIndices.length)
    drawPart(1, screenIndexBuffer, geometry.screenIndices.length)
    animationFrame = requestAnimationFrame(render)
  }

  const resumeRendering = () => {
    if (destroyed || rendering || !desiredRunning || document.hidden) return
    rendering = true
    previousTime = 0
    animationFrame = requestAnimationFrame(render)
  }

  const pauseRendering = () => {
    rendering = false
    cancelAnimationFrame(animationFrame)
    animationFrame = 0
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!(options.interactive ?? true) || destroyed) return
    dragging = true
    activePointerId = event.pointerId
    lastPointerX = event.clientX
    lastPointerY = event.clientY
    canvas.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointerId) return
    rotation.y += (event.clientX - lastPointerX) * 0.009
    rotation.x = Math.max(-0.75, Math.min(0.75, rotation.x + (event.clientY - lastPointerY) * 0.009))
    lastPointerX = event.clientX
    lastPointerY = event.clientY
  }

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return
    dragging = false
    activePointerId = null
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId)
  }

  const onVisibilityChange = () => {
    if (document.hidden) pauseRendering()
    else resumeRendering()
  }

  const onReducedMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerEnd)
  canvas.addEventListener('pointercancel', onPointerEnd)
  document.addEventListener('visibilitychange', onVisibilityChange)
  reducedMotionQuery.addEventListener('change', onReducedMotionChange)

  const api: DeviceRendererAPI = {
    canvas,
    screen,
    start() {
      if (destroyed) return
      desiredRunning = true
      resumeRendering()
    },
    stop() {
      desiredRunning = false
      pauseRendering()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      desiredRunning = false
      pauseRendering()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      reducedMotionQuery.removeEventListener('change', onReducedMotionChange)
      for (const buffer of buffers) gl.deleteBuffer(buffer)
      gl.deleteTexture(texture)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    },
    setRotation(x, y) {
      rotation = { x: Math.max(-0.75, Math.min(0.75, x)), y }
    },
    resetRotation() {
      rotation = { ...DEFAULT_ROTATION }
    },
  }

  resumeRendering()
  return api
}
