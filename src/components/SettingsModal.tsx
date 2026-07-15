import { useState } from 'preact/hooks'
import { authApi, clearSession, type PublicUser } from '../api'
import type { Messages } from '../i18n'
import { Modal } from './Modal'

export function SettingsModal({
  t,
  user,
  onClose,
  onDeleted,
}: {
  t: Messages
  user: PublicUser
  onClose: () => void
  onDeleted: () => void
}) {
  const [error, setError] = useState('')

  return (
    <Modal onClose={onClose} labelledBy="settings-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="settings-title">{t.settings}</h2>
      <p class="modal-copy">
        {t.signedInAs} {user.email}
      </p>
      {error && <p class="form-error">{error}</p>}
      <button
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
    </Modal>
  )
}
