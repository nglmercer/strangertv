import { useEffect } from 'preact/hooks'
import type { Messages } from '../../i18n'
import type { MediaErrorCode } from '../../utils/mediaErrors'
import { MediaSettings } from '../MediaSettings'

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
  labelsVisible,
  deviceLost,
  muted,
  cameraOn,
  onToggleMute,
  onToggleCamera,
}: {
  t: Messages
  devices: { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }
  videoId: string
  audioId: string
  onVideoChange: (id: string) => void
  onAudioChange: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  ensureStream: (force?: boolean) => Promise<MediaStream>
  refreshDevices: () => Promise<unknown>
  stream: MediaStream | null
  streamVersion: number
  labelsVisible: boolean
  deviceLost: 'video' | 'audio' | null
  muted: boolean
  cameraOn: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
}) {
  useEffect(() => {
    // Reuses a live stream when there is one, so opening this tab mid-call
    // never disturbs what the peer is receiving.
    void ensureStream().catch(() => undefined)
    void refreshDevices()
    // once when tab mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div class="prefs-tab-panel" role="tabpanel">
      <MediaSettings
        t={t}
        stream={stream}
        streamVersion={streamVersion}
        devices={devices}
        videoId={videoId}
        audioId={audioId}
        setVideoId={onVideoChange}
        setAudioId={onAudioChange}
        errorCode={errorCode}
        acquiring={acquiring}
        labelsVisible={labelsVisible}
        deviceLost={deviceLost}
        muted={muted}
        cameraOn={cameraOn}
        onToggleMute={onToggleMute}
        onToggleCamera={onToggleCamera}
        onRetry={() => void ensureStream(true).catch(() => undefined)}
        onRefresh={() => void refreshDevices()}
      />
    </div>
  )
}
