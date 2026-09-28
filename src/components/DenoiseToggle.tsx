import type { Messages } from '../i18n'

/**
 * Enable/disable switch for mic noise reduction. Renders nothing where the
 * worklet path is unsupported (those clients keep browser-native processing).
 */
export function DenoiseToggle({
  t,
  supported,
  enabled,
  onToggle,
}: {
  t: Messages
  supported: boolean
  enabled: boolean
  onToggle: () => void
}) {
  if (!supported) return null
  return (
    <label class="toggle-label" title={t.denoiseHint}>
      <input type="checkbox" checked={enabled} onChange={onToggle} />
      <span>{t.denoise}</span>
    </label>
  )
}
