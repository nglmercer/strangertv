export type ChatMessage = { text: string; mine: boolean; time: string }

export type Quality = 'idle' | 'connecting' | 'good' | 'poor' | 'failed'

/** 1-on-1 call arrangement: stacked (vertical) or side-by-side (horizontal). */
export type SoloLayout = 'vertical' | 'horizontal'

/** Group call arrangement: uniform grid or active-speaker spotlight. */
export type GroupLayout = 'grid' | 'spotlight'

export type UiSettings = {
  soloLayout: SoloLayout
  groupLayout: GroupLayout
}

export const SOLO_LAYOUTS: readonly SoloLayout[] = ['vertical', 'horizontal']
export const GROUP_LAYOUTS: readonly GroupLayout[] = ['grid', 'spotlight']

export const DEFAULT_UI_SETTINGS: UiSettings = {
  soloLayout: 'horizontal',
  groupLayout: 'grid',
}
