import { useEffect } from 'preact/hooks'

type Options = {
  active: boolean
  muted: boolean
  cameraOn: boolean
  setMuted: (v: boolean) => void
  setCamera: (v: boolean) => void
  onNext: () => void
  onStop: () => void
  canNext: boolean
}

/** Global call shortcuts: M mute, C camera, N next, Esc stop. */
export function useCallKeyboard({
  active,
  muted,
  cameraOn,
  setMuted,
  setCamera,
  onNext,
  onStop,
  canNext,
}: Options) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'm') {
        e.preventDefault()
        setMuted(!muted)
      } else if (key === 'c') {
        e.preventDefault()
        setCamera(!cameraOn)
      } else if (key === 'n' && canNext) {
        e.preventDefault()
        onNext()
      } else if (key === 'escape') {
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, muted, cameraOn, setMuted, setCamera, onNext, onStop, canNext])
}
