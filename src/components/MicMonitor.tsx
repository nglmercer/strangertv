import { useEffect, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { Switch } from './Switch'

/**
 * Mic monitor: routes the live mic to the speakers so the user can verify
 * their audio before (or during) a call. Off by default — monitoring with
 * open speakers feeds back, hence the headphone hint.
 *
 * The monitor follows the app mute (a muted track carries silence) and the
 * switch disables itself while muted or without an audio track, so it can
 * never look live while producing nothing. The graph is torn down on
 * toggle-off, stream swap, and unmount.
 */
export function MicMonitor({
  t,
  stream,
  streamVersion,
  muted,
}: {
  t: Messages
  stream: MediaStream | null
  streamVersion: number
  muted: boolean
}) {
  const [monitoring, setMonitoring] = useState(false)
  const hasAudio = (stream?.getAudioTracks().length ?? 0) > 0
  const disabled = muted || !hasAudio

  useEffect(() => {
    if (disabled) setMonitoring(false)
  }, [disabled])

  useEffect(() => {
    if (!monitoring || !stream) return
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    let ctx: AudioContext | null = null
    let src: MediaStreamAudioSourceNode | null = null
    try {
      ctx = new AC()
      src = ctx.createMediaStreamSource(stream)
      src.connect(ctx.destination)
      // The toggle click is a user gesture, but the context is born in an
      // effect — resume in case it started suspended.
      if (ctx.state === 'suspended') void ctx.resume()
    } catch {
      ctx = null
      src = null
    }
    return () => {
      try {
        src?.disconnect()
      } catch {
        // Already torn down.
      }
      if (ctx) void ctx.close().catch(() => undefined)
    }
  }, [monitoring, stream, streamVersion])

  return (
    <Switch
      label={t.micMonitor}
      hint={t.micMonitorHint}
      checked={monitoring}
      disabled={disabled}
      onToggle={() => setMonitoring((v) => !v)}
    />
  )
}
