import { useState } from 'preact/hooks'
import type { ReportReason } from '../../shared/types'
import { REPORT_REASONS } from '../../shared/constants'
import type { Messages } from '../i18n'
import { Modal } from './Modal'

export function ReportModal({
  t,
  onClose,
  onSubmit,
}: {
  t: Messages
  onClose: () => void
  onSubmit: (reason: ReportReason, detail: string) => void
}) {
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [detail, setDetail] = useState('')

  return (
    <Modal onClose={onClose} labelledBy="report-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="report-title">{t.reportTitle}</h2>
      <label>
        {t.reportReason}
        <select value={reason} onChange={(e) => setReason(e.currentTarget.value as ReportReason)}>
          {REPORT_REASONS.map((r) => (
            <option value={r} key={r}>
              {t.reasons[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.reportDetail}
        <textarea value={detail} onInput={(e) => setDetail(e.currentTarget.value)} rows={3} maxLength={500} />
      </label>
      <button class="match full danger" onClick={() => onSubmit(reason, detail)}>
        {t.reportSubmit}
      </button>
    </Modal>
  )
}
