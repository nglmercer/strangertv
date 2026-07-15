import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

export function useMedia() {
  const streamRef = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({
    video: [],
    audio: [],
  })
  const [videoId, setVideoId] = useState('')
  const [audioId, setAudioId] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [error, setError] = useState('')

  const refreshDevices = useCallback(async () => {
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

  const ensureStream = useCallback(async () => {
    setError('')
    const constraints: MediaStreamConstraints = {
      video: videoId ? { deviceId: { exact: videoId } } : true,
      audio: audioId ? { deviceId: { exact: audioId } } : true,
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !muted
      })
      streamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = cameraOn
      })
      await refreshDevices()
      return streamRef.current
    } catch {
      setError('camera')
      throw new Error('camera')
    }
  }, [videoId, audioId, muted, cameraOn, refreshDevices])

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
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
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
    refreshDevices,
  }
}
