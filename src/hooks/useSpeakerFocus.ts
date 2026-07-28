import { useEffect, useRef, useState } from 'preact/hooks'
import { AudioLevelMeter } from '../utils/audioLevels'

export type FocusParticipant = { id: string; stream: MediaStream | null }

/** Level above which a participant counts as speaking. */
export const SPEECH_ON = 0.14
/** Level below which the current speaker is considered silent. */
const SPEECH_OFF = 0.08
/** A challenger must be louder than the current speaker by this factor to steal focus. */
const TAKEOVER_MARGIN = 1.3
/** Minimum time (ms) a speaker keeps focus before anyone can take it. */
const MIN_HOLD_MS = 900
/** Level sampling interval (ms). */
const SAMPLE_MS = 110

export type SpeakerFocus = {
  /** id of the participant holding the floor (last speaker when everyone is silent). */
  activeId: string | null
  /** Smoothed 0..1 level per participant id. */
  levels: Record<string, number>
}

/**
 * Tracks audio levels across participants and elects an active speaker with
 * hysteresis: the current speaker keeps focus while audible, and a challenger
 * must be clearly louder (and the hold window expired) to take over.
 */
export function useSpeakerFocus(participants: FocusParticipant[], enabled: boolean): SpeakerFocus {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const meterRef = useRef<AudioLevelMeter | null>(null)
  const smoothRef = useRef<Map<string, number>>(new Map())
  const activeRef = useRef<string | null>(null)
  const sinceRef = useRef(0)
  const streamIdsRef = useRef(new WeakMap<MediaStream, number>())
  const nextStreamIdRef = useRef(1)

  const participantsKey = participants
    .map((p) => {
      if (!p.stream) return `${p.id}:n`
      let sid = streamIdsRef.current.get(p.stream)
      if (!sid) {
        sid = nextStreamIdRef.current++
        streamIdsRef.current.set(p.stream, sid)
      }
      return `${p.id}:${sid}`
    })
    .join(',')

  useEffect(() => {
    if (!enabled) {
      setActiveId(null)
      activeRef.current = null
      setLevels({})
      smoothRef.current.clear()
      if (meterRef.current) {
        meterRef.current.dispose()
        meterRef.current = null
      }
      return
    }

    const meter = meterRef.current ?? new AudioLevelMeter()
    meterRef.current = meter
    for (const p of participants) meter.setStream(p.id, p.stream)

    const timer = window.setInterval(() => {
      const raw = meter.readLevels()
      const smooth = smoothRef.current
      const now = Date.now()

      let bestId: string | null = null
      let bestLevel = 0
      const snapshot: Record<string, number> = {}
      for (const [id, level] of raw) {
        const prev = smooth.get(id) ?? 0
        const next = level > prev ? prev + (level - prev) * 0.55 : prev + (level - prev) * 0.18
        smooth.set(id, next)
        snapshot[id] = Math.round(next * 20) / 20
        if (next > bestLevel) {
          bestLevel = next
          bestId = id
        }
      }
      for (const id of [...smooth.keys()]) {
        if (!raw.has(id)) smooth.delete(id)
      }

      const current = activeRef.current
      const currentLevel = current ? (smooth.get(current) ?? 0) : 0
      const currentAudible = current != null && currentLevel >= SPEECH_OFF
      const challengerStrong =
        bestId != null &&
        bestId !== current &&
        bestLevel >= SPEECH_ON &&
        (!currentAudible || bestLevel >= currentLevel * TAKEOVER_MARGIN)
      const holdExpired = now - sinceRef.current >= MIN_HOLD_MS

      let next = current
      if (next == null && bestId != null && bestLevel >= SPEECH_ON) {
        next = bestId
      } else if (challengerStrong && (holdExpired || !currentAudible)) {
        next = bestId
      } else if (current != null && !smooth.has(current)) {
        next = bestId
      }

      if (next !== current) {
        activeRef.current = next
        sinceRef.current = now
        setActiveId(next)
      }
      setLevels((prev) => {
        for (const [id, v] of Object.entries(prev)) {
          if (!(id in snapshot) && v !== 0) snapshot[id] = 0
        }
        const a = JSON.stringify(prev)
        const b = JSON.stringify(snapshot)
        return a === b ? prev : snapshot
      })
    }, SAMPLE_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [enabled, participantsKey])

  useEffect(
    () => () => {
      meterRef.current?.dispose()
      meterRef.current = null
    },
    [],
  )

  return { activeId, levels }
}
