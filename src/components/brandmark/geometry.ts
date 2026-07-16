export interface SmartDeviceGeometry {
  positions: Float32Array
  normals: Float32Array
  chassisIndices: Uint16Array
  screenIndices: Uint16Array
  starIndices: Uint16Array
}

interface BoxParams {
  wFront: number
  hFront: number
  wBack: number
  hBack: number
  zFront: number
  zBack: number
  yOffset?: number
}

function computeQuadNormal(p0: number[], p1: number[], p2: number[]): [number, number, number] {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2]
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  return len > 0.0001 ? [nx / len, ny / len, nz / len] : [0, 0, 1]
}

export function makeSmartDevice(): SmartDeviceGeometry {
  const positionsList: number[] = []
  const normalsList: number[] = []
  const chassisIndicesList: number[] = []
  let vertexCount = 0

  // Procedural box builder with CCW wind order & dynamic shading normals
  function pushBox({ wFront, hFront, wBack, hBack, zFront, zBack, yOffset = 0 }: BoxParams) {
    const f_bl = [-wFront, -hFront + yOffset, zFront]
    const f_br = [wFront, -hFront + yOffset, zFront]
    const f_tr = [wFront, hFront + yOffset, zFront]
    const f_tl = [-wFront, hFront + yOffset, zFront]

    const b_br = [wBack, -hBack + yOffset, zBack]
    const b_bl = [-wBack, -hBack + yOffset, zBack]
    const b_tl = [-wBack, hBack + yOffset, zBack]
    const b_tr = [wBack, hBack + yOffset, zBack]

    const faces = [
      { verts: [f_bl, f_br, f_tr, f_tl] }, // Front (+Z)
      { verts: [b_br, b_bl, b_tl, b_tr] }, // Back (-Z)
      { verts: [f_tl, f_tr, b_tr, b_tl] }, // Top (+Y)
      { verts: [b_bl, b_br, f_br, f_bl] }, // Bottom (-Y)
      { verts: [b_bl, f_bl, f_tl, b_tl] }, // Left (-X)
      { verts: [f_br, b_br, b_tr, f_tr] }, // Right (+X)
    ]

    for (const face of faces) {
      const n = computeQuadNormal(face.verts[0], face.verts[1], face.verts[2])
      for (const v of face.verts) {
        positionsList.push(...v)
        normalsList.push(...n)
      }

      const o = vertexCount
      chassisIndicesList.push(
        o, o + 1, o + 2,
        o, o + 2, o + 3
      )
      vertexCount += 4
    }
  }

  // 1. Sleek premium tapered display chassis
  pushBox({
    wFront: 1.6,
    hFront: 1.0,
    wBack: 1.4,
    hBack: 0.8,
    zFront: 0.35,
    zBack: -0.35,
    yOffset: 0
  })

  // Elegant metal neck/stand
  pushBox({
    wFront: 0.12,
    hFront: 0.25,
    wBack: 0.10,
    hBack: 0.25,
    zFront: 0.05,
    zBack: -0.15,
    yOffset: -1.25
  })

  // Ultra-sleek display base plate
  pushBox({
    wFront: 0.5,
    hFront: 0.04,
    wBack: 0.45,
    hBack: 0.04,
    zFront: 0.35,
    zBack: -0.35,
    yOffset: -1.52
  })

  const chassisIndices = new Uint16Array(chassisIndicesList)

  // 2. High-precision glass screen panel on front skin
  const screenStartIdx = vertexCount
  const sWidth = 1.6 * 0.93
  const sHeight = 1.0 * 0.93
  const sDepth = 0.35 + 0.006

  positionsList.push(
    -sWidth, -sHeight, sDepth,
     sWidth, -sHeight, sDepth,
     sWidth,  sHeight, sDepth,
    -sWidth,  sHeight, sDepth
  )
  normalsList.push(
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  )
  const screenIndices = new Uint16Array([
    screenStartIdx, screenStartIdx + 1, screenStartIdx + 2,
    screenStartIdx, screenStartIdx + 2, screenStartIdx + 3
  ])
  vertexCount += 4

  // 3. Ultra-detailed 3D faceted star (bevelled pyramid structure)
  const starStartIdx = vertexCount
  const starIndicesList: number[] = []

  const rOuter = 0.45
  const rInner = 0.45 * 0.4
  const starDepth = sDepth + 0.006
  const bevelHeight = 0.08

  // Center tip pushed forward
  const centerPt = [0.0, 0.0, starDepth + bevelHeight]

  // Outer and inner star points
  const starPts: number[][] = []
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    const r = i % 2 === 0 ? rOuter : rInner
    starPts.push([r * Math.cos(angle), r * Math.sin(angle), starDepth])
  }

  // Generate 10 independent facet triangles for sharp metallic edge reflections
  for (let i = 0; i < 10; i++) {
    const pCurrent = starPts[i]
    const pNext = starPts[(i + 1) % 10]

    positionsList.push(...centerPt, ...pCurrent, ...pNext)

    const n = computeQuadNormal(centerPt, pCurrent, pNext)
    normalsList.push(...n, ...n, ...n)

    const o = starStartIdx + i * 3
    starIndicesList.push(o, o + 1, o + 2)
  }

  const starIndices = new Uint16Array(starIndicesList)

  const positions = new Float32Array(positionsList)
  const normals = new Float32Array(normalsList)

  return { positions, normals, chassisIndices, screenIndices, starIndices }
}
