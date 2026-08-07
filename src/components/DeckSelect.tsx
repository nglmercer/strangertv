import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { Icon, icons } from './icons'

export type DeckOption = {
  value: string
  label: string
  /** Optional leading icon path (from `icons`). */
  icon?: string
}

type Anchor = { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

const MIN_WIDTH = 240
const GAP = 8
const MAX_HEIGHT = 320
const EDGE = 8

/** Strips accents so "peru" matches "Perú". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Deck dropdown rendered in a portal on document.body.
 *
 * The deck lives inside `.dashboard`, which clips overflow, so an in-flow menu
 * is cut off by its own ancestors. Portalling it out and positioning it from
 * the trigger's viewport rect keeps it above everything, and lets it flip below
 * the trigger when there is not enough room above.
 */
export function DeckSelect({
  t,
  label,
  value,
  options,
  onChange,
  searchable = false,
  triggerIcon,
  triggerLabel,
  triggerTitle,
}: {
  t: Messages
  /** Accessible name of the list (e.g. "Country"). */
  label: string
  value: string
  options: DeckOption[]
  onChange: (value: string) => void
  searchable?: boolean
  triggerIcon: ComponentChildren
  triggerLabel: string
  triggerTitle: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = normalize(query.trim())
    return options.filter((o) => normalize(o.label).includes(q) || normalize(o.value).includes(q))
  }, [options, query, searchable])

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, MIN_WIDTH)
    const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, window.innerWidth - width - EDGE))
    const above = rect.top - GAP - EDGE
    const below = window.innerHeight - rect.bottom - GAP - EDGE
    // Prefer opening upward (the deck sits at the bottom of the page) unless
    // the space below is meaningfully bigger.
    setAnchor(
      above >= Math.min(MAX_HEIGHT, below) || above >= below
        ? { left, width, bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) }
        : { left, width, top: rect.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) },
    )
  }

  // Re-measure after mount in case the trigger moved between click and paint.
  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open])

  useEffect(() => {
    if (!open) return
    // The search box takes focus when there is one; otherwise the list itself
    // does, so the arrow keys work no matter how the menu was opened.
    if (searchRef.current) searchRef.current.focus()
    else menuRef.current?.focus()

    const reposition = () => place()
    const onDown = (e: Event) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const openMenu = () => {
    // Measure before opening so the first render is already positioned (and the
    // search box exists to receive focus).
    place()
    setQuery('')
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + step + shown.length) % shown.length)
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActiveIndex(e.key === 'Home' ? 0 : shown.length - 1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const option = shown[activeIndex]
      if (option) pick(option.value)
    }
  }

  const menu = open && anchor && (
    <div
      ref={menuRef}
      class="deck-select-menu"
      role="listbox"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        left: `${anchor.left}px`,
        width: `${anchor.width}px`,
        maxHeight: `${anchor.maxHeight}px`,
        ...(anchor.top != null ? { top: `${anchor.top}px` } : { bottom: `${anchor.bottom}px` }),
      }}
    >
      {searchable && (
        <div class="deck-select-search">
          <Icon d={icons.search} size={15} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t.search}
            aria-label={`${t.search} — ${label}`}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value)
              setActiveIndex(0)
            }}
          />
        </div>
      )}
      <div class="deck-select-list">
        {shown.map((option, index) => {
          const selected = option.value === value
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              data-active={index === activeIndex}
              class={`deck-select-item ${selected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(option.value)}
            >
              <span class="deck-select-icon">{option.icon ? <Icon d={option.icon} size={16} /> : null}</span>
              <span class="deck-select-label">{option.label}</span>
              <span class="deck-select-check">{selected ? <Icon d={icons.check} size={16} /> : null}</span>
            </button>
          )
        })}
        {shown.length === 0 && <p class="deck-select-empty">{t.noResults}</p>}
      </div>
    </div>
  )

  return (
    <div class={`deck-card deck-dropdown ${open ? 'open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        class="deck-dropdown-trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            openMenu()
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={triggerTitle}
      >
        <span class="deck-emoji" aria-hidden="true">
          {triggerIcon}
        </span>
        <small>{triggerLabel}</small>
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
