import { useEffect, useState } from 'preact/hooks'
import { authApi, clearSession, socialApi, type PublicUser } from '../api'
import type { Messages } from '../i18n'
import { requestNotifyPermission } from '../utils/notify'
import { Modal } from './Modal'

type BlockRow = { id: number; email: string | null; createdAt: string | null }

export function SettingsModal({
  t,
  user,
  onClose,
  onDeleted,
  onUserUpdate,
}: {
  t: Messages
  user: PublicUser
  onClose: () => void
  onDeleted: () => void
  onUserUpdate?: (u: PublicUser) => void
}) {
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [blocks, setBlocks] = useState<BlockRow[]>([])
  const [sound, setSound] = useState(() => localStorage.getItem('stranger-match-sound') !== '0')
  const [notify, setNotify] = useState(() => localStorage.getItem('stranger-match-notify') === '1')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void socialApi
      .listBlocks()
      .then((r) => setBlocks(r.blocked))
      .catch(() => undefined)
  }, [])

  return (
    <Modal onClose={onClose} labelledBy="settings-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="settings-title">{t.settings}</h2>
      <p class="modal-copy">
        {t.signedInAs} {user.email}
        {user.emailVerified ? ` · ✓ ${t.emailVerifiedShort}` : ` · ${t.emailUnverified}`}
      </p>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {info && <p class="form-info">{info}</p>}

      {!user.emailVerified && (
        <button
          type="button"
          class="match full"
          disabled={loading}
          onClick={async () => {
            setError('')
            setInfo('')
            setLoading(true)
            try {
              const res = await authApi.resendVerification()
              setInfo(
                res.devVerifyToken
                  ? `${t.verifySent} Dev: ${res.devVerifyToken}`
                  : t.verifySent,
              )
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Error')
            } finally {
              setLoading(false)
            }
          }}
        >
          {t.resendVerify}
        </button>
      )}

      <fieldset class="settings-field">
        <legend>{t.notifications}</legend>
        <label class="check-row">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              const v = e.currentTarget.checked
              setSound(v)
              localStorage.setItem('stranger-match-sound', v ? '1' : '0')
            }}
          />
          <span>{t.matchSound}</span>
        </label>
        <label class="check-row">
          <input
            type="checkbox"
            checked={notify}
            onChange={async (e) => {
              const want = e.currentTarget.checked
              if (want) {
                const ok = await requestNotifyPermission()
                if (!ok) {
                  setError(t.notifyDenied)
                  e.currentTarget.checked = false
                  return
                }
              }
              setNotify(want)
              localStorage.setItem('stranger-match-notify', want ? '1' : '0')
            }}
          />
          <span>{t.matchNotify}</span>
        </label>
      </fieldset>

      <div class="settings-blocks">
        <h3>{t.blockedUsers}</h3>
        {blocks.length === 0 && <p class="muted-inline">{t.noBlocks}</p>}
        <ul class="block-list">
          {blocks.map((b) => (
            <li key={b.id}>
              <span>{b.email ?? `#${b.id}`}</span>
              <button
                type="button"
                class="admin-btn sm"
                onClick={async () => {
                  try {
                    await socialApi.unblock(b.id)
                    setBlocks((list) => list.filter((x) => x.id !== b.id))
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Error')
                  }
                }}
              >
                {t.unblock}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        class="match full danger"
        onClick={async () => {
          if (!confirm(t.deleteAccount + '?')) return
          try {
            await authApi.deleteAccount()
            clearSession()
            onDeleted()
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Error')
          }
        }}
      >
        {t.deleteAccount}
      </button>
      {onUserUpdate && user.emailVerified === false && (
        <button
          type="button"
          class="switch"
          onClick={() =>
            void authApi.me().then((r) => onUserUpdate(r.user)).catch(() => undefined)
          }
        >
          {t.refreshAccount}
        </button>
      )}
    </Modal>
  )
}
