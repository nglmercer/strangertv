import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

export function Modal({
  children,
  onClose,
  className = 'modal',
  labelledBy,
}: {
  children: ComponentChildren
  onClose: () => void
  className?: string
  labelledBy?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = ref.current
    const focusable = root?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      if (e.key !== 'Tab' || !focusable?.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])

  return (
    <div class="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onCloseRef.current()}>
      <section ref={ref} class={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>
  )
}
