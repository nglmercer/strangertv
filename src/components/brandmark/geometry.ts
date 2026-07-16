// geometry.ts
export interface SmartDeviceGeometry {
  positions: Float32Array
  normals: Float32Array
  chassisIndices: Uint16Array
  screenIndices: Uint16Array
  starIndices: Uint16Array // Reused for the premium 3D Orbit Connection emblem
}

export function makeSmartDevice(): SmartDeviceGeometry {
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

  // Front Bevel Ring (0 - 7)
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x, y, inner)
    const dX = Math.sign(x), dY = Math.sign(y)
    chassisNormals.push(dX * 0.3, dY * 0.3, 0.9)
  }
  // Front Plateau (8 - 15)
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x * 0.94, y * 0.94, outer)
    chassisNormals.push(0, 0, 1)
  }
  // Back Bevel Ring (16 - 23)
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x, y, -inner)
    const dX = Math.sign(x), dY = Math.sign(y)
    chassisNormals.push(dX * 0.3, dY * 0.3, -0.9)
  }
  // Back Plateau (24 - 31)
  for (const [x, y] of squareProfile) {
    chassisPositions.push(x * 0.94, y * 0.94, -outer)
    chassisNormals.push(0, 0, -1)
  }

  // Cap centers
  const frontCenterIdx = 32
  chassisPositions.push(0, 0, outer)
  chassisNormals.push(0, 0, 1)

  const backCenterIdx = 33
  chassisPositions.push(0, 0, -outer)
  chassisNormals.push(0, 0, -1)

  // Corrected outward-facing triangle builder
  const addTriangle = (p0: number, p1: number, p2: number) => {
    // Front-facing winding order check
    const v1x = chassisPositions[p1 * 3] - chassisPositions[p0 * 3]
    const v1y = chassisPositions[p1 * 3 + 1] - chassisPositions[p0 * 3 + 1]
    const v1z = chassisPositions[p1 * 3 + 2] - chassisPositions[p0 * 3 + 2]

    const v2x = chassisPositions[p2 * 3] - chassisPositions[p0 * 3]
    const v2y = chassisPositions[p2 * 3 + 1] - chassisPositions[p0 * 3 + 1]
    const v2z = chassisPositions[p2 * 3 + 2] - chassisPositions[p0 * 3 + 2]

    const nx = v1y * v2z - v1z * v2y
    const ny = v1z * v2x - v1x * v2z
    const nz = v1x * v2y - v1y * v2x

    const cx = (chassisPositions[p0 * 3] + chassisPositions[p1 * 3] + chassisPositions[p2 * 3]) / 3
    const cy = (chassisPositions[p0 * 3 + 1] + chassisPositions[p1 * 3 + 1] + chassisPositions[p2 * 3 + 1]) / 3
    const cz = (chassisPositions[p0 * 3 + 2] + chassisPositions[p1 * 3 + 2] + chassisPositions[p2 * 3 + 2]) / 3

    if (nx * cx + ny * cy + nz * cz < 0) {
      chassisIndicesList.push(p0, p2, p1)
    } else {
      chassisIndicesList.push(p0, p1, p2)
    }
  }

  // Connect Rings cleanly with outward normals
  const connectRings = (r1: number, r2: number) => {
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8
      addTriangle(r1 + i, r1 + next, r2 + i)
      addTriangle(r1 + next, r2 + next, r2 + i)
    }
  }

  connectRings(0, 8)       // Front Ring to Front Plateau
  connectRings(24, 16)     // Back Plateau to Back Ring
  connectRings(16, 0)      // Side connection: Back to Front

  // Cap the front and back flat plateaus
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8
    addTriangle(frontCenterIdx, 8 + next, 8 + i)
    addTriangle(backCenterIdx, 24 + i, 24 + next)
  }

  // --- 2. PERFECT SQUARE WATERFALL GLASS SCREEN ---
  const screenPositions: number[] = []
  const screenNormals: number[] = []
  const screenIndicesList: number[] = []

  const sSize = size - 0.08
  const screenBaseIdx = chassisPositions.length / 3
  const xSegments = 12
  const ySegments = 12

  for (let y = 0; y <= ySegments; y++) {
    const pctY = y / ySegments
    const posY = -sSize + pctY * (sSize * 2)

    for (let x = 0; x <= xSegments; x++) {
      const pctX = x / xSegments
      const posX = -sSize + pctX * (sSize * 2)

      const normalizedX = posX / sSize
      const curveDepth = 0.035 * (1.0 - normalizedX * normalizedX)
      const posZ = outer + 0.009 + curveDepth

      screenPositions.push(posX, posY, posZ)

      const nx = normalizedX * 0.15
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

  // --- 3. SLEEK NEW BRAND LOGO: 3D DIAMOND STAR + ORBIT RING ---
  const logoPositions: number[] = []
  const logoNormals: number[] = []
  const logoIndicesList: number[] = []

  const logoBaseIdx = (chassisPositions.length + screenPositions.length) / 3
  const centerZ = outer + 0.06

  // 3.1 Draw Central Diamond Star (Octahedron)
  const starHalfWidth = 0.14
  const starHalfHeight = 0.22
  const starDepth = 0.08

  const starVerts = [
    [0, starHalfHeight, centerZ],               // Top (0)
    [0, -starHalfHeight, centerZ],              // Bottom (1)
    [-starHalfWidth, 0, centerZ],               // Left (2)
    [starHalfWidth, 0, centerZ],                // Right (3)
    [0, 0, centerZ + starDepth],                // Front Peak (4)
    [0, 0, centerZ - starDepth / 2]             // Back (5)
  ]

  for (const [vx, vy, vz] of starVerts) {
    logoPositions.push(vx, vy, vz)
    const length = Math.hypot(vx, vy, vz - centerZ) || 1
    logoNormals.push(vx / length, vy / length, (vz - centerZ) / length)
  }

  // Octahedron index connections
  const starFaces = [
    [4, 0, 3], [4, 3, 1], [4, 1, 2], [4, 2, 0], // Front facets
    [5, 3, 0], [5, 1, 3], [5, 2, 1], [5, 0, 2]  // Back facets
  ]
  for (const [a, b, c] of starFaces) {
    logoIndicesList.push(logoBaseIdx + a, logoBaseIdx + b, logoBaseIdx + c)
  }

  // 3.2 Draw Diagonal Orbit Torus Ring
  const ringStartIdx = logoBaseIdx + starVerts.length
  const radialSteps = 36
  const tubeSteps = 8
  const ringRadius = 0.28
  const tubeRadius = 0.02

  const tiltAngle = 0.35 // Stunning diagonal dynamic orbit slant

  for (let i = 0; i <= radialSteps; i++) {
    const theta = (i / radialSteps) * Math.PI * 2
    const rawX = ringRadius * Math.cos(theta)
    const rawY = ringRadius * Math.sin(theta)

    // Apply rotation around Y/X-axis for the orbital tilt effect
    const rx = rawX * Math.cos(tiltAngle)
    const ry = rawY
    const rz = centerZ + rawX * Math.sin(tiltAngle)

    for (let j = 0; j < tubeSteps; j++) {
      const phi = (j / tubeSteps) * Math.PI * 2
      const nx = Math.cos(phi) * Math.cos(theta)
      const ny = Math.sin(phi)
      const nz = Math.cos(phi) * Math.sin(theta)

      logoPositions.push(rx + tubeRadius * nx, ry + tubeRadius * ny, rz + tubeRadius * nz)

      // Calculate smooth normal vector for the torus
      const normLength = Math.hypot(nx, ny, nz) || 1
      logoNormals.push(nx / normLength, ny / normLength, nz / normLength)
    }
  }

  for (let i = 0; i < radialSteps; i++) {
    const r0 = ringStartIdx + i * tubeSteps
    const r1 = ringStartIdx + (i + 1) * tubeSteps
    for (let j = 0; j < tubeSteps; j++) {
      const nextJ = (j + 1) % tubeSteps
      logoIndicesList.push(r0 + j, r1 + j, r0 + nextJ)
      logoIndicesList.push(r0 + nextJ, r1 + j, r1 + nextJ)
    }
  }

  return {
    positions: new Float32Array([...chassisPositions, ...screenPositions, ...logoPositions]),
    normals: new Float32Array([...chassisNormals, ...screenNormals, ...logoNormals]),
    chassisIndices: new Uint16Array(chassisIndicesList),
    screenIndices: new Uint16Array(screenIndicesList),
    starIndices: new Uint16Array(logoIndicesList),
  }
}
