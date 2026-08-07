/**
 * Browsers hand back raw driver strings for devices: trailing USB ids, a
 * "Default - " prefix on the system device, and an empty label until the user
 * has granted permission. These helpers turn them into something readable.
 */

/** ` (04f2:b6d9)` — USB vendor:product id most drivers append. */
const USB_ID = /\s*\((?:[0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i
/** Chrome prefixes the system default entries. */
const SYSTEM_PREFIX = /^(default|communications)\s*-\s*/i

export function prettyDeviceLabel(label: string): string {
  return label.replace(USB_ID, '').replace(SYSTEM_PREFIX, '').trim()
}

/**
 * Display name for a device, falling back to "Camera 2" / "Microphone 3" while
 * labels are hidden (no permission yet) or the driver reports none.
 */
export function deviceName(device: MediaDeviceInfo, index: number, fallbackKind: string): string {
  const pretty = prettyDeviceLabel(device.label)
  return pretty || `${fallbackKind} ${index + 1}`
}
