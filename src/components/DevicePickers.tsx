import type { Messages } from '../i18n'
import {
  mediaErrorHelp,
  mediaErrorMessage,
  type MediaErrorCode,
} from '../utils/mediaErrors'

type Devices = { video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }

/**
 * Camera / mic selectors + recovery actions (retry, refresh list).
 * Shared by start wizard and preferences.
 */
export function DevicePickers({
  t,
  devices,
  videoId,
  audioId,
  setVideoId,
  setAudioId,
  errorCode,
  acquiring,
  onRetry,
  onRefresh,
}: {
  t: Messages
  devices: Devices
  videoId: string
  audioId: string
  setVideoId: (id: string) => void
  setAudioId: (id: string) => void
  errorCode: MediaErrorCode | null
  acquiring: boolean
  onRetry: () => void
  onRefresh: () => void
}) {
  const errText = errorCode ? mediaErrorMessage(t, errorCode) : ''
  const helpText = errorCode ? mediaErrorHelp(t, errorCode) : ''

  return (
    <div class="device-pickers">
      {errText && (
        <div class="media-error" role="alert">
          <p class="form-error">{errText}</p>
          {helpText && <p class="media-help">{helpText}</p>}
        </div>
      )}
      <label>
        {t.deviceCam}
        <select
          value={videoId}
          disabled={acquiring}
          onChange={(e) => setVideoId(e.currentTarget.value)}
        >
          <option value="">{t.deviceDefault}</option>
          {devices.video.map((d) => (
            <option value={d.deviceId} key={d.deviceId}>
              {d.label || d.deviceId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.deviceMic}
        <select
          value={audioId}
          disabled={acquiring}
          onChange={(e) => setAudioId(e.currentTarget.value)}
        >
          <option value="">{t.deviceDefault}</option>
          {devices.audio.map((d) => (
            <option value={d.deviceId} key={d.deviceId}>
              {d.label || d.deviceId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
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
