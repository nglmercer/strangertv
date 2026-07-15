import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { loadDeviceIds, saveAudioDeviceId, saveVideoDeviceId } from '../utils/clientStorage'
import { classifyMediaError, type MediaErrorCode } from '../utils/mediaErrors'

export type MediaDevicesState = { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }

export type EnsureStreamOpts = {
  /** Force these ids for this acquire (and persist). */
  videoId?: string
  audioId?: string
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  })
}

function trackDeviceId(track: MediaStreamTrack | undefined): string {
  if (!track) return ''
  try {
    return track.getSettings().deviceId ?? ''
  } catch {
    return ''
  }
}

export function useMedia() {
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDevicesState>({ video: [], audio: [] })
  const initialDevices = loadDeviceIds()
  const [videoId, setVideoIdState] = useState(initialDevices.videoId)
  const [audioId, setAudioIdState] = useState(initialDevices.audioId)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<MediaErrorCode | null>(null)
  const [acquiring, setAcquiring] = useState(false)
  /** Bumps when stream instance changes so UI previews rebind. */
  const [streamVersion, setStreamVersion] = useState(0)

  const videoIdRef = useRef(videoId)
  const audioIdRef = useRef(audioId)
  const mutedRef = useRef(muted)
  const cameraOnRef = useRef(cameraOn)
  mutedRef.current = muted
  cameraOnRef.current = cameraOn

  const setVideoId = useCallback((id: string) => {
    // Sync ref immediately — callers often ensureStream() in the same tick.
    videoIdRef.current = id
    setVideoIdState(id)
    saveVideoDeviceId(id)
  }, [])

  const setAudioId = useCallback((id: string) => {
    audioIdRef.current = id
    setAudioIdState(id)
    saveAudioDeviceId(id)
  }, [])

  const applyTrackFlags = useCallback((stream: MediaStream) => {
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !mutedRef.current
    })
    stream.getVideoTracks().forEach((t) => {
      t.enabled = cameraOnRef.current
    })
  }, [])

  const publishStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream
    applyTrackFlags(stream)
    setStreamVersion((n) => n + 1)
  }, [applyTrackFlags])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        video: list.filter((d) => d.kind === 'videoinput'),
        audio: list.filter((d) => d.kind === 'audioinput'),
      })
    } catch {
      /* permission not yet granted */
    }
  }, [])

  const openStream = useCallback(async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    return navigator.mediaDevices.getUserMedia(constraints)
  }, [])

  /**
   * Acquire camera + mic for the currently selected device ids.
   * Uses `exact` when a device id is set so switching actually applies.
   */
  const ensureStream = useCallback(
    async (opts?: EnsureStreamOpts) => {
      if (opts?.videoId !== undefined) {
        videoIdRef.current = opts.videoId
        setVideoIdState(opts.videoId)
        saveVideoDeviceId(opts.videoId)
      }
      if (opts?.audioId !== undefined) {
        audioIdRef.current = opts.audioId
        setAudioIdState(opts.audioId)
        saveAudioDeviceId(opts.audioId)
      }

      const vId = videoIdRef.current
      const aId = audioIdRef.current

      setAcquiring(true)
      setError('')
      setErrorCode(null)

      if (!navigator.mediaDevices?.getUserMedia) {
        const classified = classifyMediaError({ name: 'NotFoundError', message: 'getUserMedia missing' })
        setError('camera')
        setErrorCode(classified.code)
        setAcquiring(false)
        throw Object.assign(new Error(classified.code), { mediaCode: classified.code })
      }

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        const classified = classifyMediaError({ name: 'SecurityError', message: 'insecure context' })
        setError('camera')
        setErrorCode(classified.code)
        setAcquiring(false)
        throw Object.assign(new Error(classified.code), { mediaCode: classified.code })
      }

      // Prefer exact so a user selection is honored; ideal allows browser to ignore the pick.
      const preferred: MediaStreamConstraints = {
        video: vId ? { deviceId: { exact: vId } } : { facingMode: { ideal: 'user' } },
        audio: aId ? { deviceId: { exact: aId } } : true,
      }

      const soft: MediaStreamConstraints = {
        video: vId ? { deviceId: { ideal: vId } } : true,
        audio: aId ? { deviceId: { ideal: aId } } : true,
      }

      const loose: MediaStreamConstraints = { video: true, audio: true }

      // If user locked a device, try preferred first then soft (not loose — that undoes the choice).
      const attempts = vId || aId ? [preferred, soft] : [preferred, soft, loose]

      let lastErr: unknown
      for (const constraints of attempts) {
        try {
          stopTracks(streamRef.current)
          streamRef.current = null
          const stream = await openStream(constraints)
          publishStream(stream)
          await refreshDevices()
          setError('')
          setErrorCode(null)
          setAcquiring(false)
          return stream
        } catch (e) {
          lastErr = e
          const code = classifyMediaError(e).code
          if (code === 'permission' || code === 'security') break
        }
      }

      // Busy / missing preferred cam: try other cameras while keeping preferred mic if possible
      try {
        await refreshDevices()
        const list = await navigator.mediaDevices.enumerateDevices()
        const cams = list.filter((d) => d.kind === 'videoinput')
        for (const cam of cams) {
          if (vId && cam.deviceId === vId) continue
          try {
            stopTracks(streamRef.current)
            streamRef.current = null
            const stream = await openStream({
              video: { deviceId: { exact: cam.deviceId } },
              audio: aId ? { deviceId: { ideal: aId } } : true,
            })
            videoIdRef.current = cam.deviceId
            setVideoIdState(cam.deviceId)
            saveVideoDeviceId(cam.deviceId)
            publishStream(stream)
            await refreshDevices()
            setError('')
            setErrorCode(null)
            setAcquiring(false)
            return stream
          } catch (e) {
            lastErr = e
          }
        }
      } catch (e) {
        lastErr = e
      }

      const classified = classifyMediaError(lastErr)
      setError('camera')
      setErrorCode(classified.code)
      setAcquiring(false)
      throw Object.assign(new Error(classified.code), { mediaCode: classified.code, cause: lastErr })
    },
    [openStream, publishStream, refreshDevices],
  )

  /**
   * Switch only one device kind without dropping the other track when possible.
   * Falls back to full ensureStream on failure.
   */
  const switchDevice = useCallback(
    async (kind: 'video' | 'audio', id: string) => {
      if (kind === 'video') setVideoId(id)
      else setAudioId(id)

      const otherVideo = kind === 'video' ? id : videoIdRef.current
      const otherAudio = kind === 'audio' ? id : audioIdRef.current

      // No active stream yet — full acquire
      if (!streamRef.current) {
        return ensureStream({ videoId: otherVideo, audioId: otherAudio })
      }

      setAcquiring(true)
      setError('')
      setErrorCode(null)

      try {
        if (kind === 'video') {
          const media = await navigator.mediaDevices.getUserMedia({
            video: id ? { deviceId: { exact: id } } : true,
            audio: false,
          })
          const nextTrack = media.getVideoTracks()[0]
          if (!nextTrack) throw new Error('no video track')

          const stream = streamRef.current
          const old = stream.getVideoTracks()
          old.forEach((t) => {
            stream.removeTrack(t)
            t.stop()
          })
          stream.addTrack(nextTrack)
          // Stop leftover empty MediaStream container tracks if any
          media.getTracks().forEach((t) => {
            if (t !== nextTrack) t.stop()
          })
          applyTrackFlags(stream)
          setStreamVersion((n) => n + 1)
          await refreshDevices()
          setAcquiring(false)
          return stream
        }

        // audio
        const media = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: id ? { deviceId: { exact: id } } : true,
        })
        const nextTrack = media.getAudioTracks()[0]
        if (!nextTrack) throw new Error('no audio track')

        const stream = streamRef.current
        const old = stream.getAudioTracks()
        old.forEach((t) => {
          stream.removeTrack(t)
          t.stop()
        })
        stream.addTrack(nextTrack)
        media.getTracks().forEach((t) => {
          if (t !== nextTrack) t.stop()
        })
        applyTrackFlags(stream)
        setStreamVersion((n) => n + 1)
        await refreshDevices()
        setAcquiring(false)
        return stream
      } catch (e) {
        // Full re-open both devices with exact ids
        try {
          return await ensureStream({ videoId: otherVideo, audioId: otherAudio })
        } catch (err) {
          const classified = classifyMediaError(err ?? e)
          setError('camera')
          setErrorCode(classified.code)
          setAcquiring(false)
          throw Object.assign(new Error(classified.code), { mediaCode: classified.code, cause: err ?? e })
        }
      }
    },
    [applyTrackFlags, ensureStream, refreshDevices, setAudioId, setVideoId],
  )

  const setMutedTrack = useCallback((value: boolean) => {
    setMuted(value)
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !value
    })
  }, [])

  const setCameraTrack = useCallback((value: boolean) => {
    setCameraOn(value)
    streamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = value
    })
  }, [])

  const stopStream = useCallback(() => {
    stopTracks(streamRef.current)
    streamRef.current = null
    setStreamVersion((n) => n + 1)
  }, [])

  const clearError = useCallback(() => {
    setError('')
    setErrorCode(null)
  }, [])

  /** Active device ids as reported by the browser (for verifying switch). */
  const activeDeviceIds = useCallback(() => {
    const s = streamRef.current
    return {
      videoId: trackDeviceId(s?.getVideoTracks()[0]),
      audioId: trackDeviceId(s?.getAudioTracks()[0]),
    }
  }, [])

  useEffect(() => {
    const onChange = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
      stopStream()
    }
  }, [refreshDevices, stopStream])

  return {
    streamRef,
    streamVersion,
    devices,
    videoId,
    audioId,
    setVideoId,
    setAudioId,
    muted,
    cameraOn,
    setMutedTrack,
    setCameraTrack,
    ensureStream,
    switchDevice,
    stopStream,
    error,
    errorCode,
    clearError,
    acquiring,
    refreshDevices,
    activeDeviceIds,
  }
}
