import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { authApi, socialApi, type PublicUser } from '../api'
import { isMatchNotifyEnabled, isMatchSoundEnabled, setMatchNotifyEnabled, setMatchSoundEnabled, clearSession } from '../utils/storage'
import type { Messages } from '../i18n'
import { requestNotifyPermission } from '../utils/notify'
import { useConfirm } from './ConfirmDialog'
import { Modal } from './Modal'
import { Icon, icons } from './icons'

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
  const [confirmUi, confirm] = useConfirm(t)
  const [info, setInfo] = useState('')
  const [blocks, setBlocks] = useState<BlockRow[]>([])
  const [sound, setSound] = useState(isMatchSoundEnabled)
  const [notify, setNotify] = useState(isMatchNotifyEnabled)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void socialApi
      .listBlocks()
      .then((r) => setBlocks(r.blocked))
      .catch(() => undefined)
  }, [])

  const displayName = user.username ?? user.email.split('@')[0] ?? user.email
  const initial = (displayName[0] ?? '?').toUpperCase()

  return (
    <Modal onClose={onClose} labelledBy="settings-title">
      {confirmUi}
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="settings-title" class="acct-title">
        {t.settings}
      </h2>

      <div class="acct-head">
        <span class="acct-avatar" aria-hidden="true">
          {initial}
        </span>
        <span class="acct-id">
          <span class="acct-name">{displayName}</span>
          <span class="acct-email">{user.email}</span>
        </span>
        {user.emailVerified ? (
          <span class="acct-badge is-ok">
            <Icon d={icons.check} size={13} /> {t.emailVerifiedShort}
          </span>
        ) : (
          <button
            type="button"
            class="acct-badge acct-verify"
            disabled={loading}
            title={t.resendVerify}
            aria-label={t.resendVerify}
            onClick={async () => {
              setError('')
              setInfo('')
              setLoading(true)
              try {
                const res = await authApi.resendVerification()
                setInfo(
                  res.devVerifyToken ? `${t.verifySent} ${t.devToken}: ${res.devVerifyToken}` : t.verifySent,
                )
              } catch (e) {
                setError(e instanceof Error ? e.message : t.genericError)
              } finally {
                setLoading(false)
              }
            }}
          >
            <span class="acct-badge-label">{t.emailUnverified}</span>
            <span class="acct-badge-hover">
              <Icon d={icons.paperPlane} size={13} /> {t.resendVerify}
            </span>
          </button>
        )}
      </div>

      {user.username && (
        <button
          type="button"
          class="acct-profile"
          onClick={() => route(`/u/${user.username}`)}
        >
          <Icon d={icons.share} size={17} />
          <span>{t.viewProfile}</span>
          <span class="acct-path">/u/{user.username}</span>
          <Icon d={icons.arrowRight} size={17} className="acct-go" />
        </button>
      )}

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {info && <p class="form-info">{info}</p>}

      <section class="acct-section" aria-label={t.notifications}>
        <h3>{t.notifications}</h3>
        <label class="acct-toggle">
          <span>{t.matchSound}</span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              const v = e.currentTarget.checked
              setSound(v)
              setMatchSoundEnabled(v)
            }}
          />
          <span class="acct-track" aria-hidden="true">
            <span class="acct-knob" />
          </span>
        </label>
        <label class="acct-toggle">
          <span>{t.matchNotify}</span>
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
              setMatchNotifyEnabled(want)
            }}
          />
          <span class="acct-track" aria-hidden="true">
            <span class="acct-knob" />
          </span>
        </label>
      </section>

      <section class="acct-section" aria-label={t.blockedUsers}>
        <h3>{t.blockedUsers}</h3>
        {blocks.length === 0 ? (
          <p class="muted-inline">{t.noBlocks}</p>
        ) : (
          <ul class="acct-blocks">
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
                      setError(e instanceof Error ? e.message : t.genericError)
                    }
                  }}
                >
                  {t.unblock}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="acct-section" aria-label={t.dangerZone}>
        <h3 class="is-danger">{t.dangerZone}</h3>
        <button
          type="button"
          class="match full danger"
          onClick={async () => {
            const ok = await confirm({
              title: t.deleteAccountTitle,
              message: t.deleteAccountConfirm,
              confirmLabel: t.deleteAccount,
              danger: true,
            })
            if (!ok) return
            try {
              await authApi.deleteAccount()
              clearSession()
              onDeleted()
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : t.genericError)
            }
          }}
        >
          {t.deleteAccount}
        </button>
      </section>

      {onUserUpdate && user.emailVerified === false && (
        <div class="acct-refresh">
          <button
            type="button"
            class="switch"
            onClick={() =>
              void authApi.me().then((r) => onUserUpdate(r.user)).catch(() => undefined)
            }
          >
            {t.refreshAccount}
          </button>
        </div>
      )}
    </Modal>
  )
}
