import { useEffect, useState } from 'preact/hooks'
import { economyApi, type EconomyLeader, type EconomyLedgerEntry } from '../api'
import { formatMessage, type Messages } from '../i18n'
import { Modal } from './Modal'

/** Seconds of placeholder sponsorship before an ad claim is submitted. */
const AD_VIEW_SECONDS = 5

function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, active])
  return now
}

function leaderName(l: EconomyLeader): string {
  return l.displayName || l.username || `#${l.userId}`
}

export function EconomyPanel({
  t,
  onClose,
  onBalance,
}: {
  t: Messages
  onClose: () => void
  onBalance: (balance: number) => void
}) {
  const [balance, setBalance] = useState<number | null>(null)
  const [recent, setRecent] = useState<EconomyLedgerEntry[]>([])
  const [leaders, setLeaders] = useState<EconomyLeader[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [adViewing, setAdViewing] = useState(0)
  const [nextClaimAt, setNextClaimAt] = useState<number | null>(null)
  const [giftTo, setGiftTo] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const now = useNow(1000, adViewing > 0 || nextClaimAt != null)
  const cooldownLeft =
    nextClaimAt != null ? Math.max(0, Math.ceil(nextClaimAt - now / 1000)) : 0

  const refresh = () => {
    void economyApi
      .me()
      .then((r) => {
        setBalance(r.balance)
        setRecent(r.recent)
        onBalance(r.balance)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t.genericError))
    void economyApi
      .leaderboard()
      .then((r) => setLeaders(r.leaders))
      .catch(() => undefined)
  }

  useEffect(refresh, [])

  useEffect(() => {
    if (adViewing <= 0) return
    if (adViewing === 1) {
      const id = window.setTimeout(() => {
        setAdViewing(0)
        setLoading(true)
        void economyApi
          .claimAd()
          .then((r) => {
            setBalance(r.balance)
            onBalance(r.balance)
            setNextClaimAt(r.nextClaimAt)
            setInfo('')
            setError('')
            void economyApi.me().then((m) => setRecent(m.recent)).catch(() => undefined)
          })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : t.genericError))
          .finally(() => setLoading(false))
      }, 1000)
      return () => window.clearTimeout(id)
    }
    const id = window.setTimeout(() => setAdViewing((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [adViewing, onBalance, t.genericError])

  const submitGift = (event: Event) => {
    event.preventDefault()
    setError('')
    setInfo('')
    const userId = Number.parseInt(giftTo, 10)
    const amount = Number.parseInt(giftAmount, 10)
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(amount) || amount <= 0) {
      return
    }
    setLoading(true)
    void economyApi
      .gift(userId, amount)
      .then((r) => {
        setBalance(r.balance)
        onBalance(r.balance)
        setInfo(t.giftSent)
        setGiftTo('')
        setGiftAmount('')
        void economyApi.me().then((m) => setRecent(m.recent)).catch(() => undefined)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t.genericError))
      .finally(() => setLoading(false))
  }

  return (
    <Modal onClose={onClose} labelledBy="economy-title">
      <div>
        <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <p class="eyebrow">{t.points}</p>
        <h2 id="economy-title">
          {t.pointsBalance}: {balance ?? '…'}
        </h2>

        {error && <p class="form-error" role="alert">{error}</p>}
        {info && <p class="form-info">{info}</p>}

        <h3>{t.earnPoints}</h3>
        {adViewing > 0 ? (
          <p class="form-info">{t.watchingAd} ({adViewing}s)</p>
        ) : cooldownLeft > 0 ? (
          <p class="form-info">{formatMessage(t.adCooldown, { seconds: cooldownLeft })}</p>
        ) : (
          <button
            type="button"
            class="match full"
            disabled={loading}
            onClick={() => setAdViewing(AD_VIEW_SECONDS)}
          >
            {t.watchAd}
          </button>
        )}

        <h3>{t.giftPoints}</h3>
        <form onSubmit={submitGift}>
          <label>
            {t.giftToUserId}
            <input
              value={giftTo}
              onInput={(e) => setGiftTo(e.currentTarget.value)}
              inputMode="numeric"
              required
            />
          </label>
          <label>
            {t.giftAmount}
            <input
              value={giftAmount}
              onInput={(e) => setGiftAmount(e.currentTarget.value)}
              inputMode="numeric"
              required
            />
          </label>
          <button class="match full" disabled={loading}>{t.giftPoints}</button>
        </form>

        <h3>{t.leaderboard}</h3>
        {leaders.length === 0 ? (
          <p class="form-info">{t.noLeaders}</p>
        ) : (
          <ol class="economy-leaders">
            {leaders.map((l, i) => (
              <li key={l.userId}>
                <span>#{i + 1} {leaderName(l)}</span>
                <span>{l.balance}</span>
              </li>
            ))}
          </ol>
        )}

        <h3>{t.pointsHistory}</h3>
        {recent.length === 0 ? (
          <p class="form-info">—</p>
        ) : (
          <ul class="economy-history">
            {recent.map((e, i) => (
              <li key={`${e.createdAt}-${i}`}>
                <span>{e.reason}{e.note ? ` — ${e.note}` : ''}</span>
                <span>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
