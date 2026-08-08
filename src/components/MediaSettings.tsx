import { useEffect, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { AudioLevelMeter } from '../utils/audioLevels'
import { deviceName } from '../utils/deviceLabels'
import { mediaErrorHelp, mediaErrorMessage, type MediaErrorCode } from '../utils/mediaErrors'
import { Icon, icons } from './icons'
import { Select } from './Select'

type Devices = { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }

const LEVEL_MS = 100

/** Live 0..1 input level for the local mic, for the meter under the picker. */
function useMicLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0)
  const meterRef = useRef<AudioLevelMeter | null>(null)

  useEffect(() => {
    if (!enabled || !stream) {
      setLevel(0)
      meterRef.current?.dispose()
      meterRef.current = null
      return
    }
    const meter = meterRef.current ?? new AudioLevelMeter()
    meterRef.current = meter
    meter.setStream('local', stream)
    const timer = window.setInterval(() => {
      const raw = meter.readLevels().get('local') ?? 0
      // Ease downward so the meter doesn't strobe between samples.
      setLevel((prev) => (raw > prev ? raw : prev * 0.7 + raw * 0.3))
    }, LEVEL_MS)
    return () => {
      window.clearInterval(timer)
      meter.dispose()
      meterRef.current = null
    }
  }, [stream, enabled])

  return level
}

/**
 * Camera + microphone configuration: live preview, optional device pickers
 * with a mic level meter, mute/camera toggles, and recovery actions.
 *
 * By default the app uses the system camera/mic. Device pickers are shown only
 * when there is a conflict (error, disconnected device, overconstrained id)
 * unless `forceDevicePickers` is set (Preferences → Devices).
 */
export function MediaSettings({
  t,
  stream,
  streamVersion,
  devices,
  videoId,
  audioId,
  setVideoId,
  setAudioId,
  errorCode,
  acquiring,
  labelsVisible,
  deviceLost,
  muted,
  cameraOn,
  onToggleMute,
  onToggleCamera,
  onRetry,
  onRefresh,
  forceDevicePickers = false,
}: {
  t: Messages
  stream: MediaStream | null
  streamVersion: number
  devices: Devices
  videoId: string
  audioId: string
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  labelsVisible: boolean
  deviceLost: 'video' | 'audio' | null
  muted: boolean
  cameraOn: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onRetry: () => void
  onRefresh: () => void
  /** Always show cam/mic selectors (Preferences). Default: only on conflict. */
  forceDevicePickers?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const level = useMicLevel(stream, !muted)

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

  const errText = errorCode ? mediaErrorMessage(t, errorCode) : ''
  const helpText = errorCode ? mediaErrorHelp(t, errorCode) : ''
  const hasVideo = Boolean(stream?.getVideoTracks().length)

  // Conflict: permission/busy/missing/wrong-id, or a live track that dropped.
  const hasConflict = Boolean(errorCode || deviceLost)
  const showDevicePickers = forceDevicePickers || hasConflict

  const cameraOptions = [
    { value: '', label: t.deviceDefault, icon: icons.camOn },
    ...devices.video.map((d, i) => ({ value: d.deviceId, label: deviceName(d, i, t.deviceCam), icon: icons.camOn })),
  ]
  const micOptions = [
    { value: '', label: t.deviceDefault, icon: icons.micOn },
    ...devices.audio.map((d, i) => ({ value: d.deviceId, label: deviceName(d, i, t.deviceMic), icon: icons.micOn })),
  ]

  return (
    <div class="media-settings">
      <div class={`media-preview ${cameraOn && hasVideo ? 'is-live' : ''}`}>
        <video ref={videoRef} autoplay playsinline muted class="preview-video" />
        {(!hasVideo || !cameraOn) && (
          <div class="media-preview-empty">
            <Icon d={cameraOn ? icons.camOn : icons.camOff} size={30} />
            <span>{acquiring ? '…' : cameraOn ? t.previewCam : t.camOff}</span>
          </div>
        )}
        {/* Toggles sit on the preview so their effect is visible immediately. */}
        <div class="media-preview-actions">
          <button
            type="button"
            class={`media-toggle ${muted ? 'is-off' : ''}`}
            onClick={onToggleMute}
            aria-pressed={muted}
            title={muted ? t.unmute : t.mute}
            aria-label={muted ? t.unmute : t.mute}
          >
            <Icon d={muted ? icons.micOff : icons.micOn} size={16} />
          </button>
          <button
            type="button"
            class={`media-toggle ${!cameraOn ? 'is-off' : ''}`}
            onClick={onToggleCamera}
            aria-pressed={!cameraOn}
            title={cameraOn ? t.camOff : t.camOn}
            aria-label={cameraOn ? t.camOff : t.camOn}
          >
            <Icon d={cameraOn ? icons.camOn : icons.camOff} size={16} />
          </button>
        </div>
      </div>

      {deviceLost && (
        <p class="media-warning" role="status">
          {t.deviceDisconnected}
        </p>
      )}
      {errText && (
        <div class="media-error" role="alert">
          <p class="form-error">{errText}</p>
          {helpText && <p class="media-help">{helpText}</p>}
        </div>
      )}
      {!labelsVisible && !errText && (
        <p class="media-hint">{t.mediaHelpPermission}</p>
      )}

      {showDevicePickers && (
        <>
          <label>
            {t.deviceCam}
            <Select
              t={t}
              label={t.deviceCam}
              value={videoId}
              options={cameraOptions}
              onChange={setVideoId}
              disabled={acquiring}
              searchable={devices.video.length > 5}
            />
          </label>

          <label>
            {t.deviceMic}
            <Select
              t={t}
              label={t.deviceMic}
              value={audioId}
              options={micOptions}
              onChange={setAudioId}
              disabled={acquiring}
              searchable={devices.audio.length > 5}
            />
            <span class="mic-meter" role="meter" aria-label={t.micLevel} aria-valuenow={Math.round(level * 100)}>
              <i style={{ width: `${Math.min(100, Math.round(level * 130))}%` }} />
            </span>
          </label>
        </>
      )}

      {!showDevicePickers && stream && !muted && (
        <span class="mic-meter" role="meter" aria-label={t.micLevel} aria-valuenow={Math.round(level * 100)}>
          <i style={{ width: `${Math.min(100, Math.round(level * 130))}%` }} />
        </span>
      )}

      <div class="device-actions">
        <button type="button" class="device-btn" disabled={acquiring} onClick={onRetry}>
          {acquiring ? '…' : t.mediaRetry}
        </button>
        <button type="button" class="device-btn ghost" disabled={acquiring} onClick={onRefresh}>
          {t.mediaRefreshDevices}
        </button>
      </div>
    </div>
  )
}
