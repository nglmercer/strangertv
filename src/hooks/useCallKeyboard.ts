import { useEffect, useRef } from 'preact/hooks'

type Options = {
  active: boolean
  muted: boolean
  cameraOn: boolean
  setMuted: (v: boolean) => void
  setCamera: (v: boolean) => void
  onNext: () => void
  onStop: () => void
  canNext: boolean
  modalOpen?: boolean
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
  modalOpen,
}: Options) {
  const mutedRef = useRef(muted)
  const cameraOnRef = useRef(cameraOn)
  const canNextRef = useRef(canNext)
  const setMutedRef = useRef(setMuted)
  const setCameraRef = useRef(setCamera)
  const onNextRef = useRef(onNext)
  const onStopRef = useRef(onStop)

  mutedRef.current = muted
  cameraOnRef.current = cameraOn
  canNextRef.current = canNext
  setMutedRef.current = setMuted
  setCameraRef.current = setCamera
  onNextRef.current = onNext
  onStopRef.current = onStop

  useEffect(() => {
    if (!active || modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      if (key === 'm') {
        e.preventDefault()
        setMutedRef.current(!mutedRef.current)
      } else if (key === 'c') {
        e.preventDefault()
        setCameraRef.current(!cameraOnRef.current)
      } else if (key === 'n' && canNextRef.current) {
        e.preventDefault()
        onNextRef.current()
      } else if (key === 'escape') {
        e.preventDefault()
        onStopRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, modalOpen])
}
