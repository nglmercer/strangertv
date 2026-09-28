import type { Messages } from '../i18n'
import { Switch } from './Switch'

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
  return <Switch label={t.denoise} hint={t.denoiseHint} checked={enabled} onToggle={onToggle} />
}
