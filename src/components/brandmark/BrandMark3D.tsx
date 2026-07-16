// BrandMark3D.tsx
import { useEffect, useRef } from 'preact/hooks'
import { translation, rotationX, rotationY, rotationZ, scaling, multiply, perspective, normalMatrix } from './math'
import { makeSmartDevice } from './geometry'
import { VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC, compileShader } from './shaders'

export function BrandMark3D({
  autoSpin = true,
  interactive = true,
  className = '',
}: {
  autoSpin?: boolean
  interactive?: boolean
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
    if (!gl) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC)
    if (!vs || !fs) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return

    const { positions, normals, chassisIndices, screenIndices, starIndices } = makeSmartDevice()

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    const aPosition = gl.getAttribLocation(program, 'aPosition')

    const normBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf)
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW)
    const aNormal = gl.getAttribLocation(program, 'aNormal')

    // Prepare Buffers
    const chassisIdxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chassisIdxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chassisIndices, gl.STATIC_DRAW)

    const screenIdxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, screenIdxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, screenIndices, gl.STATIC_DRAW)

    const starIdxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, starIdxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, starIndices, gl.STATIC_DRAW)

    // Uniforms
    const uProjection = gl.getUniformLocation(program, 'uProjection')
    const uModelView = gl.getUniformLocation(program, 'uModelView')
    const uNormalMatrix = gl.getUniformLocation(program, 'uNormalMatrix')
    const uLightDir = gl.getUniformLocation(program, 'uLightDir')
    const uChassisColor = gl.getUniformLocation(program, 'uChassisColor')
    const uScreenColor = gl.getUniformLocation(program, 'uScreenColor')
    const uStarColor = gl.getUniformLocation(program, 'uStarColor')
    const uPart = gl.getUniformLocation(program, 'uPart')

    let rotX = 0.25
    let rotY = 0.5
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      if (!interactive) return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      canvas.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      rotY += (e.clientX - lastX) * 0.01
      rotX += (e.clientY - lastY) * 0.01
      lastX = e.clientX
      lastY = e.clientY
    }
    const onUp = () => {
      dragging = false
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width * dpr))
      const h = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    let raf = 0
    let running = true
    const render = () => {
      if (!running) return
      resize()
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.enable(gl.DEPTH_TEST)
      gl.enable(gl.CULL_FACE)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      if (autoSpin && !dragging && !reduceMotion) {
        rotY += 0.007
      }

      const aspect = canvas.width / canvas.height
      const projection = perspective((35 * Math.PI) / 180, aspect, 0.1, 50)

      let model = translation(0, 0, -6)
      model = multiply(model, rotationX(rotX))
      model = multiply(model, rotationY(rotY))

      gl.useProgram(program)
      gl.uniformMatrix4fv(uProjection, false, projection)
      gl.uniformMatrix4fv(uModelView, false, model)
      gl.uniformMatrix3fv(uNormalMatrix, false, normalMatrix(model))
      gl.uniform3f(uLightDir, 0.5, 0.8, 1.0)

      // Device Materials configuration
      gl.uniform3f(uChassisColor, 0.12, 0.12, 0.14) // Dark Matte Frame
      gl.uniform3f(uScreenColor, 0.05, 0.07, 0.12)  // Display Obsidian Blue
      gl.uniform3f(uStarColor, 1.0, 0.5, 0.0)        // Bright Orange Star

      // Bind buffer attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.enableVertexAttribArray(aPosition)
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf)
      gl.enableVertexAttribArray(aNormal)
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0)

      // 1. Draw Body
      gl.uniform1f(uPart, 0.0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chassisIdxBuf)
      gl.drawElements(gl.TRIANGLES, chassisIndices.length, gl.UNSIGNED_SHORT, 0)

      // 2. Draw Glass Screen
      gl.uniform1f(uPart, 1.0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, screenIdxBuf)
      gl.drawElements(gl.TRIANGLES, screenIndices.length, gl.UNSIGNED_SHORT, 0)

      // 3. Draw Emblem Star
      gl.uniform1f(uPart, 2.0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, starIdxBuf)
      gl.drawElements(gl.TRIANGLES, starIndices.length, gl.UNSIGNED_SHORT, 0)

      raf = requestAnimationFrame(render)
    }

    const start = () => {
      if (!running) {
        running = true
        raf = requestAnimationFrame(render)
      }
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(render)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      gl.deleteBuffer(posBuf)
      gl.deleteBuffer(normBuf)
      gl.deleteBuffer(chassisIdxBuf)
      gl.deleteBuffer(screenIdxBuf)
      gl.deleteBuffer(starIdxBuf)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    }
  }, [autoSpin, interactive])

  return (
    <canvas
      ref={canvasRef}
      class={`brand-mark-3d ${className}`}
      aria-hidden="true"
      style={{ touchAction: 'none', display: 'block', width: '100%', height: '100%' }}
    />
  )
}
