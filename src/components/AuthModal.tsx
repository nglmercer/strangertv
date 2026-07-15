import { useState } from 'preact/hooks'
import { authApi, setSession, type PublicUser } from '../api'
import type { Messages } from '../i18n'
import { isAdult } from '../utils/age'
import { Modal } from './Modal'

export function AuthModal({
  t,
  onClose,
  onAuth,
}: {
  t: Messages
  onClose: () => void
  onAuth: (user: PublicUser) => void
}) {
  const [registering, setRegistering] = useState(false)
  const [resetMode, setResetMode] = useState<'off' | 'request' | 'confirm'>('off')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [birthDate, setBirthDate] = useState(localStorage.getItem('stranger-birth-date') ?? '')
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      if (resetMode === 'request') {
        const res = await authApi.requestReset(email)
        setInfo(res.devResetToken ? `Dev token: ${res.devResetToken}` : 'If that email exists, a reset was created.')
        if (res.devResetToken) {
          setResetToken(res.devResetToken)
          setResetMode('confirm')
        }
        return
      }
      if (resetMode === 'confirm') {
        await authApi.confirmReset(resetToken, password)
        setInfo('Password updated. You can sign in.')
        setResetMode('off')
        return
      }
      if (registering && !isAdult(birthDate)) {
        setError(t.mustBe18)
        return
      }
      const res = registering
        ? await authApi.register({ email, password, birthDate })
        : await authApi.login({ email, password })
      setSession(res.token, res.user)
      if (res.user.birthDate) {
        localStorage.setItem('stranger-birth-date', res.user.birthDate)
        localStorage.setItem('stranger-profile-complete', 'true')
      }
      onAuth(res.user)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="auth-title">
      <form onSubmit={submit}>
        <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <p class="eyebrow">
          {resetMode !== 'off' ? t.resetPassword : registering ? t.register : t.login}
        </p>
        <h2 id="auth-title">
          {resetMode !== 'off' ? t.resetPassword : registering ? t.savePrefs : t.continueConv}
        </h2>
        <label>
          {t.email}
          <input value={email} onInput={(e) => setEmail(e.currentTarget.value)} type="email" required />
        </label>
        {resetMode !== 'request' && (
          <label>
            {resetMode === 'confirm' ? t.newPassword : t.password}
            <input
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
        )}
        {resetMode === 'confirm' && (
          <label>
            Token
            <input value={resetToken} onInput={(e) => setResetToken(e.currentTarget.value)} required />
          </label>
        )}
        {registering && resetMode === 'off' && (
          <label>
            {t.birthday}
            <input type="date" value={birthDate} onInput={(e) => setBirthDate(e.currentTarget.value)} required />
          </label>
        )}
        {error && <p class="form-error" role="alert">{error}</p>}
        {info && <p class="form-info">{info}</p>}
        <button class="match full" disabled={loading}>
          {resetMode === 'request'
            ? t.sendReset
            : resetMode === 'confirm'
              ? t.confirmReset
              : registering
                ? t.register
                : t.signIn}
        </button>
        {resetMode === 'off' && (
          <>
            <button type="button" class="switch" onClick={() => setRegistering(!registering)}>
              {registering ? t.alreadyAccount : t.newHere}
            </button>
            <button type="button" class="switch" onClick={() => setResetMode('request')}>
              {t.resetPassword}
            </button>
          </>
        )}
        {resetMode !== 'off' && (
          <button type="button" class="switch" onClick={() => setResetMode('off')}>
            {t.signIn}
          </button>
        )}
      </form>
    </Modal>
  )
}
