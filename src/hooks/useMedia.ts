import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { loadDeviceIds, saveAudioDeviceId, saveVideoDeviceId } from '../utils/clientStorage'
import { classifyMediaError, type MediaErrorCode } from '../utils/mediaErrors'

export type MediaDevicesState = { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export function useMedia() {
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDevicesState>({ video: [], audio: [] })
  const initialDevices = loadDeviceIds()
  const [videoId, setVideoIdState] = useState(initialDevices.videoId)
  const [audioId, setAudioIdState] = useState(initialDevices.audioId)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  /** Legacy flag — true when last ensureStream failed. */
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<MediaErrorCode | null>(null)
  const [acquiring, setAcquiring] = useState(false)
  const videoIdRef = useRef(videoId)
  const audioIdRef = useRef(audioId)
  videoIdRef.current = videoId
  audioIdRef.current = audioId
  const mutedRef = useRef(muted)
  const cameraOnRef = useRef(cameraOn)
  mutedRef.current = muted
  cameraOnRef.current = cameraOn

  const setVideoId = useCallback((id: string) => {
    setVideoIdState(id)
    saveVideoDeviceId(id)
  }, [])

  const setAudioId = useCallback((id: string) => {
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

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        video: list.filter((d) => d.kind === 'videoinput'),
        audio: list.filter((d) => d.kind === 'audioinput'),
      })
    } catch {
      /* permission not yet granted — labels stay empty */
    }
  }, [])

  const openStream = useCallback(
    async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      applyTrackFlags(stream)
      return stream
    },
    [applyTrackFlags],
  )

  /**
   * Acquire camera + mic. Retries with softer constraints and alternate devices
   * when the preferred camera is busy or missing.
   */
  const ensureStream = useCallback(async () => {
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

    const vId = videoIdRef.current
    const aId = audioIdRef.current

    const attempts: MediaStreamConstraints[] = [
      {
        video: vId ? { deviceId: { ideal: vId } } : { facingMode: 'user' },
        audio: aId ? { deviceId: { ideal: aId } } : true,
      },
      // Drop exact-ish device preference entirely
      { video: true, audio: true },
      // Last resort: video only then we fail clearly (mic optional for preview recovery)
      { video: true, audio: false },
    ]

    let lastErr: unknown
    for (const constraints of attempts) {
      try {
        stopTracks(streamRef.current)
        streamRef.current = null
        const stream = await openStream(constraints)
        streamRef.current = stream
        // If ideal device was ignored, keep saved preference; user can re-pick.
        await refreshDevices()
        setError('')
        setErrorCode(null)
        setAcquiring(false)
        return stream
      } catch (e) {
        lastErr = e
        const code = classifyMediaError(e).code
        // Permission denied won't improve with retries
        if (code === 'permission' || code === 'security') break
      }
    }

    // Camera busy / not found: try each videoinput explicitly (other cams may work)
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
          streamRef.current = stream
          setVideoId(cam.deviceId)
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
  }, [openStream, refreshDevices, setVideoId])

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
  }, [])

  const clearError = useCallback(() => {
    setError('')
    setErrorCode(null)
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
    stopStream,
    error,
    errorCode,
    clearError,
    acquiring,
    refreshDevices,
  }
}
