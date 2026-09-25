import { useRef, useState } from 'preact/hooks'
import { API_ROUTES } from '../../../shared/constants'
import { mediaApi } from '../../api'
import { initials } from '../../pages/profileMock'
import { Icon, icons } from '../icons'
import { EditorCard } from './EditorFields'

/**
 * Profile photo card: preview, upload, remove. Staged uploads (picked but
 * not yet saved by the parent's autosave) are deleted immediately when
 * replaced or removed, so abandoned picks don't orphan blobs; the saved
 * avatar is only cleared server-side on save.
 */
export function AvatarCard({
  avatarId,
  displayName,
  onChange,
}: {
  avatarId: number | null
  displayName: string
  onChange: (id: number | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const staged = useRef<number | null>(null)

  const forgetStaged = (except: number | null) => {
    const stale = staged.current
    staged.current = except
    if (stale != null && stale !== except) void mediaApi.remove(stale).catch(() => {})
  }

  const upload = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    const res = await mediaApi.uploadFile('avatar', file)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    forgetStaged(res.upload.id)
    onChange(res.upload.id)
  }

  const remove = () => {
    if (busy) return
    setError(null)
    forgetStaged(null)
    onChange(null)
  }

  return (
    <EditorCard>
      <div class="pedit-avatar-row">
        {avatarId != null ? (
          <img
            class="pedit-avatar-img"
            src={API_ROUTES.mediaById(avatarId)}
            alt=""
            width={56}
            height={56}
          />
        ) : (
          <span class="pedit-avatar-fallback" aria-hidden="true">
            {initials(displayName || '?')}
          </span>
        )}
        <div class="pedit-avatar-actions">
          <p class="pedit-section-title">Profile photo</p>
          <div class="pedit-avatar-btns">
            <button
              type="button"
              class="pedit-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Icon d={icons.camOn} size={15} />
              <span>{avatarId != null ? 'Change' : 'Upload'}</span>
            </button>
            {avatarId != null && (
              <button type="button" class="pedit-btn" disabled={busy} onClick={remove}>
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            void upload(e.currentTarget.files?.[0])
            e.currentTarget.value = ''
          }}
        />
      </div>
      {error && <p class="pedit-error">{error}</p>}
    </EditorCard>
  )
}
