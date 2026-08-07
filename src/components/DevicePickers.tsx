import type { Messages } from '../i18n'
import { Select } from './Select'
import { icons } from './icons'
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
        <Select
          t={t}
          label={t.deviceCam}
          value={videoId}
          disabled={acquiring}
          options={[
            { value: '', label: t.deviceDefault, icon: icons.camOn },
            ...devices.video.map((d) => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 8), icon: icons.camOn })),
          ]}
          onChange={setVideoId}
          searchable={devices.video.length > 5}
        />
      </label>
      <label>
        {t.deviceMic}
        <Select
          t={t}
          label={t.deviceMic}
          value={audioId}
          disabled={acquiring}
          options={[
            { value: '', label: t.deviceDefault, icon: icons.micOn },
            ...devices.audio.map((d) => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 8), icon: icons.micOn })),
          ]}
          onChange={setAudioId}
          searchable={devices.audio.length > 5}
        />
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
