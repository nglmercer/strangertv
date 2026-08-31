import { DEVICE_CONFIG, type DeviceConfig } from './deviceConfig'

export interface SmartDeviceGeometry {
  positions: Float32Array<ArrayBuffer>
  normals: Float32Array<ArrayBuffer>
  uvs: Float32Array<ArrayBuffer>
  chassisIndices: Uint16Array<ArrayBuffer>
  bezelIndices: Uint16Array<ArrayBuffer>
  screenIndices: Uint16Array<ArrayBuffer>
}

type Point = readonly [number, number]

function roundedRectangle(width: number, height: number, radius: number, segmentCount: number): Point[] {
  const halfWidth = width / 2
  const halfHeight = height / 2
  const safeRadius = Math.min(radius, halfWidth, halfHeight)
  const perCorner = Math.max(2, Math.round(segmentCount / 4))
  const centers: Point[] = [
    [halfWidth - safeRadius, halfHeight - safeRadius],
    [-halfWidth + safeRadius, halfHeight - safeRadius],
    [-halfWidth + safeRadius, -halfHeight + safeRadius],
    [halfWidth - safeRadius, -halfHeight + safeRadius],
  ]
  const points: Point[] = []

  for (let corner = 0; corner < 4; corner += 1) {
    const [centerX, centerY] = centers[corner]
    const startAngle = corner * Math.PI * 0.5
    for (let step = 0; step < perCorner; step += 1) {
      const angle = startAngle + (step / perCorner) * Math.PI * 0.5
      points.push([
        centerX + Math.cos(angle) * safeRadius,
        centerY + Math.sin(angle) * safeRadius,
      ])
    }
  }

  return points
}

function appendFace(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  profile: Point[],
  width: number,
  height: number,
  z: number,
): void {
  const centerIndex = positions.length / 3
  positions.push(0, 0, z)
  normals.push(0, 0, 1)
  uvs.push(0.5, 0.5)

  for (const [x, y] of profile) {
    positions.push(x, y, z)
    normals.push(0, 0, 1)
    // The display contract uses top-left (0, 0). Canvas uploads are therefore
    // intentionally not Y-flipped by the renderer.
    uvs.push(x / width + 0.5, 0.5 - y / height)
  }

  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length
    indices.push(centerIndex, centerIndex + index + 1, centerIndex + next + 1)
  }
}

export function makeSmartDevice(config: DeviceConfig = DEVICE_CONFIG): SmartDeviceGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const chassisIndices: number[] = []
  const bezelIndices: number[] = []
  const screenIndices: number[] = []

  const chassisProfile = roundedRectangle(
    config.width,
    config.height,
    config.cornerRadius,
    config.perimeterSegments,
  )
  const frontZ = config.depth / 2
  const backZ = -frontZ

  // The side wall uses duplicated front/back vertices so its normals stay
  // independent from the planar caps, producing a clean satin edge highlight.
  for (const [x, y] of chassisProfile) {
    const insetX = Math.max(0, Math.abs(x) - (config.width / 2 - config.cornerRadius))
    const insetY = Math.max(0, Math.abs(y) - (config.height / 2 - config.cornerRadius))
    const length = Math.hypot(insetX, insetY)
    const normalX = length > 0 ? (Math.sign(x) * insetX) / length : Math.sign(x)
    const normalY = length > 0 ? (Math.sign(y) * insetY) / length : Math.sign(y)

    positions.push(x, y, frontZ, x, y, backZ)
    normals.push(normalX, normalY, 0, normalX, normalY, 0)
    uvs.push(0, 0, 0, 0)
  }

  for (let index = 0; index < chassisProfile.length; index += 1) {
    const next = (index + 1) % chassisProfile.length
    const front = index * 2
    const back = front + 1
    const nextFront = next * 2
    const nextBack = nextFront + 1
    chassisIndices.push(front, back, nextFront, nextFront, back, nextBack)
  }

  appendFace(positions, normals, uvs, chassisIndices, chassisProfile, config.width, config.height, frontZ)

  const backCenter = positions.length / 3
  positions.push(0, 0, backZ)
  normals.push(0, 0, -1)
  uvs.push(0, 0)
  const backStart = positions.length / 3
  for (const [x, y] of chassisProfile) {
    positions.push(x, y, backZ)
    normals.push(0, 0, -1)
    uvs.push(0, 0)
  }
  for (let index = 0; index < chassisProfile.length; index += 1) {
    const next = (index + 1) % chassisProfile.length
    chassisIndices.push(backCenter, backStart + next, backStart + index)
  }

  const screenWidth = config.width * config.screenScale
  const screenHeight = config.height * config.screenScale
  const bezelWidth = screenWidth + config.bezelWidth * 2
  const bezelHeight = screenHeight + config.bezelWidth * 2
  const screenRadius = Math.max(0.07, config.cornerRadius * 0.62)
  const bezelProfile = roundedRectangle(
    bezelWidth,
    bezelHeight,
    screenRadius + config.bezelWidth,
    config.perimeterSegments,
  )
  const screenProfile = roundedRectangle(
    screenWidth,
    screenHeight,
    screenRadius,
    config.perimeterSegments,
  )

  appendFace(
    positions,
    normals,
    uvs,
    bezelIndices,
    bezelProfile,
    bezelWidth,
    bezelHeight,
    frontZ + config.screenInset * 0.48,
  )
  appendFace(
    positions,
    normals,
    uvs,
    screenIndices,
    screenProfile,
    screenWidth,
    screenHeight,
    frontZ + config.screenInset,
  )

  if (positions.length / 3 > 65_535) {
    throw new Error('Device geometry exceeds the Uint16 index limit')
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    chassisIndices: new Uint16Array(chassisIndices),
    bezelIndices: new Uint16Array(bezelIndices),
    screenIndices: new Uint16Array(screenIndices),
  }
}
