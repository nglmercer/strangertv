import { useMemo, useState } from 'preact/hooks'
import { monthIndex, monthKeys, monthLabel, type Messages, type MonthKey } from '../i18n'
import { adultBirthYears, daysInMonth, isAdult } from '../utils/age'
import { markAgeGateComplete } from '../utils/clientStorage'
import { Modal } from './Modal'

export function ProfileModal({ t, onComplete }: { t: Messages; onComplete: () => void }) {
  const [birthday, setBirthday] = useState({ month: '' as MonthKey | '', day: '', year: '' })
  const [error, setError] = useState('')

  const years = useMemo(() => adultBirthYears(), [])
  const month = birthday.month ? monthIndex(birthday.month) : 0
  const yearNum = birthday.year ? Number(birthday.year) : 0
  const maxDay = daysInMonth(yearNum, month)
  const dayOptions = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay],
  )

  const complete = () => {
    if (!birthday.month) return
    const m = monthIndex(birthday.month)
    const day = Math.min(Number(birthday.day), daysInMonth(Number(birthday.year), m))
    const normalized = `${birthday.year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isAdult(normalized)) {
      setError(t.mustBe18)
      return
    }
    markAgeGateComplete(normalized)
    onComplete()
  }

  const onYearChange = (year: string) => {
    const nextMonth = birthday.month ? monthIndex(birthday.month) : 0
    const max = daysInMonth(Number(year), nextMonth)
    const day = birthday.day && Number(birthday.day) > max ? String(max) : birthday.day
    setBirthday({ ...birthday, year, day })
  }

  const onMonthChange = (key: MonthKey | '') => {
    const nextMonth = key ? monthIndex(key) : 0
    const max = daysInMonth(yearNum, nextMonth)
    const day = birthday.day && Number(birthday.day) > max ? String(max) : birthday.day
    setBirthday({ ...birthday, month: key, day })
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
            onChange={(e) => onMonthChange(e.currentTarget.value as MonthKey | '')}
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
            {dayOptions.map((d) => (
              <option value={d} key={d}>
                {d}
              </option>
            ))}
          </select>
          <select value={birthday.year} onChange={(e) => onYearChange(e.currentTarget.value)}>
            <option value="">{t.year}</option>
            {years.map((y) => (
              <option value={y} key={y}>
                {y}
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
