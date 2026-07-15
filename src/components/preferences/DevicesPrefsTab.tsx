import { useEffect, useRef } from 'preact/hooks'
import type { Messages } from '../../i18n'
import type { MediaErrorCode } from '../../utils/mediaErrors'
import { DevicePickers } from '../DevicePickers'

export function DevicesPrefsTab({
  t,
  devices,
  videoId,
  audioId,
  onVideoChange,
  onAudioChange,
  errorCode,
  acquiring,
  ensureStream,
  refreshDevices,
  stream,
  streamVersion,
}: {
  t: Messages
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  onVideoChange: (id: string) => void
  onAudioChange: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  ensureStream: () => Promise<MediaStream>
  refreshDevices: () => Promise<void>
  stream: MediaStream | null
  streamVersion: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    void ensureStream().catch(() => undefined)
    void refreshDevices()
    // once when tab mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (stream) {
      if (el.srcObject !== stream) el.srcObject = stream
      void el.play().catch(() => undefined)
    } else {
      el.srcObject = null
    }
  }, [stream, streamVersion])

  return (
    <div class="prefs-tab-panel" role="tabpanel">
      <div class="preview-wrap prefs-preview">
        <video ref={videoRef} autoplay playsinline muted class="preview-video" />
        {!stream && <span class="preview-empty">{t.previewCam}</span>}
      </div>
      <DevicePickers
        t={t}
        devices={devices}
        videoId={videoId}
        audioId={audioId}
        setVideoId={onVideoChange}
        setAudioId={onAudioChange}
        errorCode={errorCode}
        acquiring={acquiring}
        onRetry={() => void ensureStream().catch(() => undefined)}
        onRefresh={() => void refreshDevices()}
      />
    </div>
  )
}
