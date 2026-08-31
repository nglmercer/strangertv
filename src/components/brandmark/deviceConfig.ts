export type DeviceColor = readonly [number, number, number]

export interface DeviceConfig {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly cornerRadius: number
  readonly perimeterSegments: number
  readonly screenScale: number
  readonly screenInset: number
  readonly screenResolution: number
  readonly bezelWidth: number
  readonly colors: {
    readonly chassis: DeviceColor
    readonly bezel: DeviceColor
  }
}

export const DEVICE_CONFIG: DeviceConfig = {
  width: 2.24,
  height: 2.24,
  depth: 1.52,
  cornerRadius: 0.18,
  perimeterSegments: 40,
  screenScale: 0.78,
  screenInset: 0.025,
  screenResolution: 512,
  bezelWidth: 0.055,
  colors: {
    chassis: [0.945, 0.29, 0.065],
    bezel: [0.025, 0.027, 0.03],
  },
}
