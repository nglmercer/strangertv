import { DEFAULT_UI_SETTINGS, GROUP_LAYOUTS, SOLO_LAYOUTS, type GroupLayout, type SoloLayout, type UiSettings } from '../types/ui'
import { getUiSettingsRaw, setUiSettingsRaw } from './storage'

export function loadUiSettings(): UiSettings {
  const raw = getUiSettingsRaw() as Partial<UiSettings> | null
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_UI_SETTINGS }
  const soloLayout = (SOLO_LAYOUTS as readonly string[]).includes(raw.soloLayout ?? '')
    ? (raw.soloLayout as SoloLayout)
    : DEFAULT_UI_SETTINGS.soloLayout
  const groupLayout = (GROUP_LAYOUTS as readonly string[]).includes(raw.groupLayout ?? '')
    ? (raw.groupLayout as GroupLayout)
    : DEFAULT_UI_SETTINGS.groupLayout
  return { soloLayout, groupLayout }
}

export function saveUiSettings(settings: UiSettings) {
  setUiSettingsRaw(settings)
}
