// geometry.ts
export interface SmartDeviceGeometry {
  positions: Float32Array
  normals: Float32Array
  chassisIndices: Uint16Array
  screenIndices: Uint16Array
  starIndices: Uint16Array // Reused for the 3D Orbit Connection emblem
}

export function makeSmartDevice(): SmartDeviceGeometry {
  // A PERFECT 1:1:1 CUBE SIZE
  const size = 1.1
  const bevel = 0.06 // Crisp chamfered edge

  const chassisPositions: number[] = []
  const chassisNormals: number[] = []
  const chassisIndicesList: number[] = []

  // --- 1. CHAMFERED 1:1:1 CUBE CHASSIS ---
  const outer = size
  const inner = size - bevel

  // 8-point profile for a perfectly square face with corner cuts
  const squareProfile = [
    [-inner,  outer], [ inner,  outer], // Top
    [ outer,  inner], [ outer, -inner], // Right
    [ inner, -outer], [-inner, -outer], // Bottom
    [-outer, -inner], [-outer,  inner]  // Left
  ]

  // Front Bevel Ring
  const frontRingStart = 0
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x, y, inner)
    const dX = Math.sign(x), dY = Math.sign(y)
    chassisNormals.push(dX * 0.3, dY * 0.3, 0.9)
  }
  // Front Plateau
  const frontPlateauStart = 8
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x * 0.94, y * 0.94, outer)
    chassisNormals.push(0, 0, 1)
  }

  // Back Bevel Ring
  const backRingStart = 16
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x, y, -inner)
    const dX = Math.sign(x), dY = Math.sign(y)
    chassisNormals.push(dX * 0.3, dY * 0.3, -0.9)
  }
  // Back Plateau
  const backPlateauStart = 24
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x * 0.94, y * 0.94, -outer)
    chassisNormals.push(0, 0, -1)
  }

  // FIXED: Ring structural connection helper now uses CCW winding order
  const connectRings = (r1: number, r2: number) => {
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8
      chassisIndicesList.push(r1 + i, r2 + i, r1 + next)
      chassisIndicesList.push(r1 + next, r2 + i, r2 + next)
    }
  }

  connectRings(frontRingStart, frontPlateauStart)
  connectRings(backPlateauStart, backRingStart)
  connectRings(backRingStart, frontRingStart)

  // Cap centers
  const frontCenterIdx = 32
  chassisPositions.push(0, 0, outer); chassisNormals.push(0, 0, 1)
  const backCenterIdx = 33
  chassisPositions.push(0, 0, -outer); chassisNormals.push(0, 0, -1)

  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8
    // Front cap remains CCW
    chassisIndicesList.push(frontCenterIdx, frontPlateauStart + next, frontPlateauStart + i)
    // FIXED: Reversed back cap to make it CCW when looking from behind
    chassisIndicesList.push(backCenterIdx, backPlateauStart + next, backPlateauStart + i)
  }

  // --- 2. PERFECT SQUARE WATERFALL SCREEN ---
  const screenPositions: number[] = []
  const screenNormals: number[] = []
  const screenIndicesList: number[] = []

  const sSize = size - 0.08
  const screenBaseIdx = chassisPositions.length / 3
  const xSegments = 10
  const ySegments = 10

  for (let y = 0; y <= ySegments; y++) {
    const pctY = y / ySegments
    const posY = -sSize + pctY * (sSize * 2)

    for (let x = 0; x <= xSegments; x++) {
      const pctX = x / xSegments
      const posX = -sSize + pctX * (sSize * 2)

      // Symmetric face curvature
      const normalizedX = posX / sSize
      const curveDepth = 0.04 * (1.0 - normalizedX * normalizedX)
      const posZ = outer + 0.008 + curveDepth

      screenPositions.push(posX, posY, posZ)

      const nx = normalizedX * 0.2
      const nz = Math.sqrt(1.0 - nx * nx)
      screenNormals.push(nx, 0.0, nz)
    }
  }

  for (let y = 0; y < ySegments; y++) {
    for (let x = 0; x < xSegments; x++) {
      const row0 = screenBaseIdx + y * (xSegments + 1)
      const row1 = screenBaseIdx + (y + 1) * (xSegments + 1)
      screenIndicesList.push(row0 + x, row0 + (x + 1), row1 + x)
      screenIndicesList.push(row0 + (x + 1), row1 + (x + 1), row1 + x)
    }
  }

  // --- 3. 3D ORBIT RING EMBLEM ---
  const ringPositions: number[] = []
  const ringNormals: number[] = []
  const ringIndicesList: number[] = []

  const ringBaseIdx = (chassisPositions.length + screenPositions.length) / 3
  const radialSteps = 32
  const tubeSteps = 8
  const ringRadius = 0.26
  const tubeRadius = 0.035
  const emblemZ = outer + 0.12

  const buildTorus = (offsetX: number, tiltAngle: number) => {
    const startIdx = ringBaseIdx + ringPositions.length / 3

    for (let i = 0; i <= radialSteps; i++) {
      const theta = (i / radialSteps) * Math.PI * 2
      const rawX = ringRadius * Math.cos(theta)
      const rawY = ringRadius * Math.sin(theta)

      const ringX = offsetX + rawX * Math.cos(tiltAngle)
      const ringY = rawY
      const ringZ = emblemZ + rawX * Math.sin(tiltAngle)

      for (let j = 0; j < tubeSteps; j++) {
        const phi = (j / tubeSteps) * Math.PI * 2
        const nx = Math.cos(phi) * Math.cos(theta)
        const ny = Math.sin(phi)
        const nz = Math.cos(phi) * Math.sin(theta)

        ringPositions.push(ringX + tubeRadius * nx, ringY + tubeRadius * ny, ringZ + tubeRadius * nz)
        ringNormals.push(nx, ny, nz)
      }
    }

    for (let i = 0; i < radialSteps; i++) {
      const r0 = startIdx + i * tubeSteps
      const r1 = startIdx + (i + 1) * tubeSteps
      for (let j = 0; j < tubeSteps; j++) {
        const nextJ = (j + 1) % tubeSteps
        ringIndicesList.push(r0 + j, r1 + j, r0 + nextJ)
        ringIndicesList.push(r0 + nextJ, r1 + j, r1 + nextJ)
      }
    }
  }

  // Two intersecting TV/Chat setup rings scaled cleanly onto the cube's front skin
  buildTorus(-0.14,  0.4)
  buildTorus( 0.14, -0.4)

  return {
    positions: new Float32Array([...chassisPositions, ...screenPositions, ...ringPositions]),
    normals: new Float32Array([...chassisNormals, ...screenNormals, ...ringNormals]),
    chassisIndices: new Uint16Array(chassisIndicesList),
    screenIndices: new Uint16Array(screenIndicesList),
    starIndices: new Uint16Array(ringIndicesList),
  }
}
