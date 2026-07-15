import { useState } from 'preact/hooks'
import { monthIndex, monthKeys, monthLabel, type Messages, type MonthKey } from '../i18n'
import { isAdult } from '../utils/age'
import { markAgeGateComplete } from '../utils/clientStorage'
import { Modal } from './Modal'

export function ProfileModal({ t, onComplete }: { t: Messages; onComplete: () => void }) {
  const [birthday, setBirthday] = useState({ month: '' as MonthKey | '', day: '', year: '' })
  const [error, setError] = useState('')

  const complete = () => {
    if (!birthday.month) return
    const month = monthIndex(birthday.month)
    const normalized = `${birthday.year}-${String(month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}`
    if (!isAdult(normalized)) {
      setError(t.mustBe18)
      return
    }
    markAgeGateComplete(normalized)
    onComplete()
  }

  return (
    <Modal onClose={() => {}} className="profile-modal" labelledBy="profile-title">
      <header>
        <h2 id="profile-title">{t.profileTitle}</h2>
      </header>
      <div class="profile-row">
        <label>{t.birthday}</label>
        <div class="selects">
          <select
            value={birthday.month}
            onChange={(e) => setBirthday({ ...birthday, month: e.currentTarget.value as MonthKey | '' })}
          >
            <option value="">{t.month}</option>
            {monthKeys().map((key) => (
              <option value={key} key={key}>
                {monthLabel(t, key)}
              </option>
            ))}
          </select>
          <select value={birthday.day} onChange={(e) => setBirthday({ ...birthday, day: e.currentTarget.value })}>
            <option value="">{t.day}</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option value={i + 1} key={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <select value={birthday.year} onChange={(e) => setBirthday({ ...birthday, year: e.currentTarget.value })}>
            <option value="">{t.year}</option>
            {Array.from({ length: 100 }, (_, i) => (
              <option value={2026 - i} key={2026 - i}>
                {2026 - i}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p class="modal-copy">{t.mustBe18}</p>
      {error && (
        <p class="form-error" style={{ padding: '0 20px' }}>
          {error}
        </p>
      )}
      <footer>
        <button
          class="next"
          disabled={!birthday.month || !birthday.day || !birthday.year}
          onClick={complete}
        >
          {t.nextBtn}
        </button>
      </footer>
    </Modal>
  )
}
