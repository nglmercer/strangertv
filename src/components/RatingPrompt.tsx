import { useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { Modal } from './Modal'

export function RatingPrompt({
  t,
  onRate,
  onSkip,
}: {
  t: Messages
  onRate: (score: number) => void
  onSkip: () => void
}) {
  const [score, setScore] = useState(0)
  return (
    <Modal onClose={onSkip} labelledBy="rate-title">
      <button type="button" class="modal-close" onClick={onSkip} aria-label={t.close}>
        ×
      </button>
      <h2 id="rate-title">{t.rateTitle}</h2>
      <p class="modal-copy">{t.rateCopy}</p>
      <div class="star-row" role="group" aria-label={t.rateTitle}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            key={n}
            class={`star ${score >= n ? 'on' : ''}`}
            onClick={() => setScore(n)}
            aria-label={`${n}`}
          >
            ★
          </button>
        ))}
      </div>
      <button type="button" class="match full" disabled={!score} onClick={() => onRate(score)}>
        {t.rateSubmit}
      </button>
      <button type="button" class="switch" onClick={onSkip}>
        {t.rateSkip}
      </button>
    </Modal>
  )
}
