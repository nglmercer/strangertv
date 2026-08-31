import type { ScreenRenderer } from '../screen'

export interface StageStatusScreenOptions {
  title: string
  body: string
  finding: boolean
}

interface ScreenSectionFrame extends StageStatusScreenOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  scale: number
  elapsed: number
  alpha: number
  offsetX: number
}

interface TextBlock {
  fontSize: number
  lines: string[]
}

const PIXEL_FONT = '"DM Mono", "SFMono-Regular", Consolas, monospace'

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = words[0]

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${line} ${words[index]}`
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = words[index]
    }
  }
  lines.push(line)
  return lines
}

function fitTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maximumSize: number,
  weight: number,
): TextBlock {
  for (let fontSize = maximumSize; fontSize >= 10; fontSize -= 1) {
    ctx.font = `${weight} ${fontSize}px ${PIXEL_FONT}`
    const lines = wrapLines(ctx, text, maxWidth)
    if (lines.length * fontSize * 1.42 <= maxHeight) return { fontSize, lines }
  }
  ctx.font = `${weight} 10px ${PIXEL_FONT}`
  return { fontSize: 10, lines: wrapLines(ctx, text, maxWidth) }
}

function smoothStep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function drawPixelFrame(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, elapsed: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#030405'
  ctx.fillRect(0, 0, width, height)

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.38, 0, width * 0.5, height * 0.38, scale * 0.62)
  glow.addColorStop(0, 'rgba(67, 23, 5, 0.32)')
  glow.addColorStop(0.48, 'rgba(19, 8, 4, 0.18)')
  glow.addColorStop(1, 'rgba(3, 4, 5, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  const grid = Math.max(24, Math.round(scale / 14))
  ctx.strokeStyle = 'rgba(255, 106, 25, 0.055)'
  ctx.lineWidth = 1
  for (let x = 0; x <= width; x += grid) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += grid) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.018)'
  for (let y = 0; y < height; y += 6) ctx.fillRect(0, y, width, 2)

  const scanY = (elapsed * 54) % (height + 80) - 40
  const scan = ctx.createLinearGradient(0, scanY - 28, 0, scanY + 28)
  scan.addColorStop(0, 'rgba(255, 106, 25, 0)')
  scan.addColorStop(0.5, 'rgba(255, 106, 25, 0.075)')
  scan.addColorStop(1, 'rgba(255, 106, 25, 0)')
  ctx.fillStyle = scan
  ctx.fillRect(0, scanY - 28, width, 56)

  const inset = scale * 0.052
  const mark = scale * 0.032
  ctx.strokeStyle = 'rgba(255, 122, 45, 0.58)'
  ctx.lineWidth = Math.max(1, scale * 0.0025)
  for (const [x, y, directionX, directionY] of [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [inset, height - inset, 1, -1],
    [width - inset, height - inset, -1, -1],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x + directionX * mark, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + directionY * mark)
    ctx.stroke()
  }
}

function beginSection(frame: ScreenSectionFrame): void {
  frame.ctx.save()
  frame.ctx.globalAlpha = frame.alpha
  frame.ctx.translate(frame.offsetX, 0)
}

function drawSignalSection(frame: ScreenSectionFrame): void {
  const { ctx, width, height, scale, elapsed, finding } = frame
  beginSection(frame)
  const centerX = width / 2
  const centerY = height * 0.34
  const pulse = (Math.sin(elapsed * (finding ? 3.4 : 1.65)) + 1) / 2
  const phase = elapsed * (finding ? 1.8 : 0.72)

  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale * 0.23)
  glow.addColorStop(0, 'rgba(255, 92, 18, 0.34)')
  glow.addColorStop(1, 'rgba(255, 92, 18, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(centerX - scale * 0.25, centerY - scale * 0.25, scale * 0.5, scale * 0.5)

  ctx.strokeStyle = `rgba(255, 106, 25, ${0.25 + pulse * 0.22})`
  ctx.lineWidth = Math.max(1.5, scale * 0.004)
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.beginPath()
    ctx.arc(centerX, centerY, scale * (0.062 + ring * 0.044 + pulse * 0.006), 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.strokeStyle = '#ff6a19'
  ctx.lineWidth = Math.max(3, scale * 0.009)
  ctx.lineCap = 'square'
  ctx.beginPath()
  ctx.arc(centerX, centerY, scale * 0.17, phase, phase + Math.PI * (finding ? 0.76 : 0.46))
  ctx.stroke()

  ctx.shadowColor = '#ff5a12'
  ctx.shadowBlur = scale * 0.052
  ctx.fillStyle = '#ff6a19'
  ctx.fillRect(centerX - scale * 0.014, centerY - scale * 0.014, scale * 0.028, scale * 0.028)
  ctx.shadowBlur = 0

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const titleBlock = fitTextBlock(ctx, frame.title, width * 0.78, height * 0.17, 30, 700)
  ctx.font = `700 ${titleBlock.fontSize}px ${PIXEL_FONT}`
  ctx.fillStyle = '#fff7f2'
  titleBlock.lines.forEach((line, index) => {
    ctx.fillText(line.toUpperCase(), centerX, height * 0.64 + index * titleBlock.fontSize * 1.35)
  })

  ctx.fillStyle = 'rgba(255, 106, 25, 0.72)'
  ctx.fillRect(width * 0.38, height * 0.84, width * 0.24, Math.max(2, scale * 0.004))
  ctx.restore()
}

function drawMessageSection(frame: ScreenSectionFrame): void {
  const { ctx, width, height, scale } = frame
  beginSection(frame)
  const left = width * 0.1
  const contentWidth = width * 0.8

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#ff6a19'
  ctx.font = `700 ${Math.round(scale * 0.026)}px ${PIXEL_FONT}`
  ctx.fillText('02 // STATUS', left, height * 0.12)
  ctx.fillStyle = 'rgba(255, 106, 25, 0.5)'
  ctx.fillRect(left, height * 0.185, contentWidth, Math.max(1, scale * 0.0025))

  const titleBlock = fitTextBlock(ctx, frame.title, contentWidth, height * 0.2, 29, 700)
  ctx.font = `700 ${titleBlock.fontSize}px ${PIXEL_FONT}`
  ctx.fillStyle = '#fff'
  titleBlock.lines.forEach((line, index) => {
    ctx.fillText(line.toUpperCase(), left, height * 0.245 + index * titleBlock.fontSize * 1.35)
  })

  const titleHeight = titleBlock.lines.length * titleBlock.fontSize * 1.35
  const bodyTop = height * 0.29 + titleHeight
  const bodyBlock = fitTextBlock(ctx, frame.body, contentWidth, height * 0.38, 21, 500)
  ctx.font = `500 ${bodyBlock.fontSize}px ${PIXEL_FONT}`
  ctx.fillStyle = '#d6d9dc'
  bodyBlock.lines.forEach((line, index) => {
    ctx.fillText(line, left, bodyTop + index * bodyBlock.fontSize * 1.48)
  })

  ctx.fillStyle = 'rgba(255, 106, 25, 0.85)'
  const blockY = height * 0.84
  for (let index = 0; index < 13; index += 1) {
    const blockWidth = scale * (index % 3 === 0 ? 0.018 : 0.008)
    ctx.fillRect(left + index * scale * 0.025, blockY, blockWidth, scale * 0.018)
  }
  ctx.fillStyle = '#737a80'
  ctx.font = `500 ${Math.round(scale * 0.022)}px ${PIXEL_FONT}`
  ctx.textAlign = 'right'
  ctx.fillText(frame.finding ? '•••' : '●', width - left, blockY - scale * 0.004)
  ctx.restore()
}

function drawPageIndicator(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, active: number): void {
  const size = scale * 0.012
  const gap = scale * 0.014
  const start = width / 2 - (size * 2 + gap) / 2
  for (let index = 0; index < 2; index += 1) {
    ctx.fillStyle = index === active ? '#ff6a19' : 'rgba(255, 106, 25, 0.22)'
    ctx.fillRect(start + index * (size + gap), height * 0.92, size, size)
  }
}

export function createStageStatusScreen(options: StageStatusScreenOptions): ScreenRenderer {
  let startedAt: number | null = null
  return ({ ctx, width, height, time }) => {
    if (startedAt === null) startedAt = time
    const elapsed = time - startedAt
    const scale = Math.min(width, height)
    const sectionDuration = 4.8
    const transitionDuration = 0.72
    const sectionPosition = elapsed % sectionDuration
    const activeSection = Math.floor(elapsed / sectionDuration) % 2
    const transition = smoothStep((sectionPosition - (sectionDuration - transitionDuration)) / transitionDuration)

    drawPixelFrame(ctx, width, height, scale, elapsed)
    const drawSection = (section: number, alpha: number, offsetX: number) => {
      const frame: ScreenSectionFrame = { ...options, ctx, width, height, scale, elapsed, alpha, offsetX }
      if (section === 0) drawSignalSection(frame)
      else drawMessageSection(frame)
    }

    if (transition > 0) {
      drawSection(activeSection, 1 - transition, -transition * width * 0.08)
      drawSection((activeSection + 1) % 2, transition, (1 - transition) * width * 0.08)
    } else {
      drawSection(activeSection, 1, 0)
    }
    drawPageIndicator(ctx, width, height, scale, transition > 0.5 ? (activeSection + 1) % 2 : activeSection)
  }
}
