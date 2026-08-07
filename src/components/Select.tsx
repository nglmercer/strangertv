import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { Icon, icons } from './icons'

export type SelectOption = {
  value: string
  label: string
  /** Leading icon path (from `icons`). */
  icon?: string
  /** Leading custom artwork (e.g. a flag), used instead of `icon`. */
  art?: ComponentChildren
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
 * Dropdown whose menu is rendered in a portal on document.body.
 *
 * Every in-flow menu here was clipped by an ancestor — the deck lives inside
 * `.dashboard` (overflow: hidden) and form fields live inside a scrolling
 * modal. Portalling the menu out and positioning it from the trigger's viewport
 * rect keeps it above everything and lets it flip sides when space runs out.
 *
 * `deck` renders the big square deck card; `field` renders a form control that
 * matches a native `<select>` in the modals.
 */
export function Select({
  t,
  label,
  value,
  options,
  onChange,
  searchable = false,
  variant = 'field',
  disabled = false,
  triggerIcon,
  triggerLabel,
  triggerTitle,
}: {
  t: Messages
  /** Accessible name of the list (e.g. "Country"). */
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  searchable?: boolean
  variant?: 'deck' | 'field'
  disabled?: boolean
  /** Deck variant only — defaults to the selected option's art/icon. */
  triggerIcon?: ComponentChildren
  /** Defaults to the selected option's label. */
  triggerLabel?: string
  triggerTitle?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
  const isDeck = variant === 'deck'

  const shown = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = normalize(query.trim())
    return options.filter((o) => normalize(o.label).includes(q) || normalize(o.value).includes(q))
  }, [options, query, searchable])

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, isDeck ? MIN_WIDTH : 0)
    const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, window.innerWidth - width - EDGE))
    const above = rect.top - GAP - EDGE
    const below = window.innerHeight - rect.bottom - GAP - EDGE
    // The deck sits at the bottom of the page, so it prefers opening upward;
    // a form field prefers downward. Either way, flip when space runs out.
    const upward = isDeck ? above >= Math.min(MAX_HEIGHT, below) || above >= below : above > Math.max(below, MAX_HEIGHT)
    setAnchor(
      upward
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
      // Inside a modal, a bubbling Escape would close the modal as well.
      e.stopPropagation()
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
      class="select-menu"
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
        <div class="select-search">
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
      <div class="select-list">
        {shown.map((option, index) => {
          const selected = option.value === value
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              data-active={index === activeIndex}
              class={`select-item ${selected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(option.value)}
            >
              <span class="select-icon">
                {option.art ?? (option.icon ? <Icon d={option.icon} size={16} /> : null)}
              </span>
              <span class="select-label">{option.label}</span>
              <span class="select-check">{selected ? <Icon d={icons.check} size={16} /> : null}</span>
            </button>
          )
        })}
        {shown.length === 0 && <p class="select-empty">{t.noResults}</p>}
      </div>
    </div>
  )

  const triggerProps = {
    ref: triggerRef,
    type: 'button' as const,
    disabled,
    onClick: () => (open ? setOpen(false) : openMenu()),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        openMenu()
      }
    },
    'aria-expanded': open,
    'aria-haspopup': 'listbox' as const,
    'aria-label': label,
    title: triggerTitle,
  }

  const art = selected?.art ?? (selected?.icon ? <Icon d={selected.icon} size={isDeck ? 24 : 16} /> : null)

  if (isDeck) {
    return (
      <div class={`deck-card deck-dropdown ${open ? 'open' : ''}`}>
        <button {...triggerProps} class="deck-dropdown-trigger">
          <span class="deck-emoji" aria-hidden="true">
            {triggerIcon ?? art}
          </span>
          <small>{triggerLabel ?? selected?.label ?? value}</small>
        </button>
        {menu && createPortal(menu, document.body)}
      </div>
    )
  }

  return (
    <>
      <button {...triggerProps} class={`field-select ${open ? 'open' : ''}`}>
        {art && <span class="field-select-art">{art}</span>}
        <span class="field-select-value">{triggerLabel ?? selected?.label ?? value}</span>
        <span class="field-select-caret" aria-hidden="true">
          <Icon d={icons.chevron} size={16} />
        </span>
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  )
}
