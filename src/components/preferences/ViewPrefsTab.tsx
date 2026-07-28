import type { GroupLayout, SoloLayout, UiSettings } from '../../types/ui'
import { GROUP_LAYOUTS, SOLO_LAYOUTS } from '../../types/ui'
import type { Messages } from '../../i18n'

function SoloPreview({ layout }: { layout: SoloLayout }) {
  return (
    <span class={`layout-mini solo-${layout}`} aria-hidden="true">
      <i class="mini-a" />
      <i class="mini-b" />
    </span>
  )
}

function GroupPreview({ layout }: { layout: GroupLayout }) {
  if (layout === 'grid') {
    return (
      <span class="layout-mini group-grid" aria-hidden="true">
        <i /><i /><i />
      </span>
    )
  }
  return (
    <span class="layout-mini group-spotlight" aria-hidden="true">
      <i class="mini-main" />
      <span class="mini-rail">
        <i /><i /><i />
      </span>
    </span>
  )
}

export function ViewPrefsTab({
  t,
  uiSettings,
  setUiSettings,
}: {
  t: Messages
  uiSettings: UiSettings
  setUiSettings: (s: UiSettings) => void
}) {
  const soloLabel: Record<SoloLayout, string> = {
    vertical: t.layoutVertical,
    horizontal: t.layoutHorizontal,
  }
  const groupLabel: Record<GroupLayout, string> = {
    grid: t.groupLayoutGrid,
    spotlight: t.groupLayoutSpotlight,
  }
  const groupHint: Record<GroupLayout, string> = {
    grid: t.groupLayoutGridHint,
    spotlight: t.groupLayoutSpotlightHint,
  }

  return (
    <div class="prefs-tab-panel" role="tabpanel">
      <fieldset class="layout-field">
        <legend>{t.viewSoloLayout}</legend>
        <p class="layout-hint">{t.viewSoloLayoutHint}</p>
        <div class="layout-picker" role="radiogroup" aria-label={t.viewSoloLayout}>
          {SOLO_LAYOUTS.map((layout) => (
            <button
              type="button"
              key={layout}
              role="radio"
              aria-checked={uiSettings.soloLayout === layout}
              class={`layout-option ${uiSettings.soloLayout === layout ? 'on' : ''}`}
              onClick={() => setUiSettings({ ...uiSettings, soloLayout: layout })}
            >
              <SoloPreview layout={layout} />
              <span class="layout-option-name">{soloLabel[layout]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="layout-field">
        <legend>{t.viewGroupLayout}</legend>
        <p class="layout-hint">{t.viewGroupLayoutHint}</p>
        <div class="layout-picker" role="radiogroup" aria-label={t.viewGroupLayout}>
          {GROUP_LAYOUTS.map((layout) => (
            <button
              type="button"
              key={layout}
              role="radio"
              aria-checked={uiSettings.groupLayout === layout}
              class={`layout-option ${uiSettings.groupLayout === layout ? 'on' : ''}`}
              onClick={() => setUiSettings({ ...uiSettings, groupLayout: layout })}
            >
              <GroupPreview layout={layout} />
              <span class="layout-option-name">{groupLabel[layout]}</span>
              <small class="layout-option-hint">{groupHint[layout]}</small>
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
