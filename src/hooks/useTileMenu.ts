import { useEffect, useRef, useState } from 'preact/hooks'

const LONG_PRESS_MS = 550
const LONG_PRESS_MOVE_PX = 10

/**
 * Shared hover/long-press menu controller for a video tile.
 *
 * Desktop reveals the menu purely via CSS (`:hover` / `:focus-within`); this
 * hook only owns the touch path, where hover does not exist: holding the tile
 * pins the menu open (`menuOpen`), and a tap while open closes it. It also
 * suppresses the synthetic click that follows a long-press so the tile's own
 * click action (e.g. select/pin) never fires by accident.
 *
 * Pass `hasActions=false` for tiles with no menu (e.g. the local tile) to make
 * every handler a no-op.
 */
export function useTileMenu(hasActions: boolean) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const pressStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const clearPress = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }
  useEffect(() => clearPress, [])

  const onPointerDown = (e: PointerEvent) => {
    if (!hasActions) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    longPressed.current = false
    pressStart.current = { x: e.clientX, y: e.clientY }
    clearPress()
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      setMenuOpen((open) => !open)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!hasActions || pressTimer.current == null) return
    const dx = e.clientX - pressStart.current.x
    const dy = e.clientY - pressStart.current.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) clearPress()
  }

  const cancelPress = () => {
    if (hasActions) clearPress()
  }

  /** Click handler: swallows click-after-longpress, toggles menu, else selects. */
  const onClick = (onSelect?: () => void) => () => {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    onSelect?.()
  }

  return {
    menuOpen,
    close: () => setMenuOpen(false),
    onClick,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelPress,
      onPointerLeave: cancelPress,
      onPointerCancel: cancelPress,
      onContextMenu: (e: Event) => {
        if (hasActions) e.preventDefault()
      },
    },
  }
}
