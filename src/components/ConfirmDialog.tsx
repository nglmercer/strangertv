import type { ComponentChildren } from 'preact'
import { useCallback, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { Modal } from './Modal'

export type ConfirmRequest = {
  /** Heading; defaults to a neutral "Are you sure?". */
  title?: string
  /** Explains what will happen. */
  message: string
  /** Label of the confirming button; defaults to "Confirm". */
  confirmLabel?: string
  /** Style the confirming button as destructive. */
  danger?: boolean
}

/**
 * In-app confirmation dialog.
 *
 * Replaces `window.confirm`, which blocks the page, ignores the app's theme and
 * language, renders the origin ("localhost:5173 dice") above the question, and
 * cannot be styled or tested.
 */
export function ConfirmDialog({
  t,
  request,
  onResolve,
}: {
  t: Messages
  request: ConfirmRequest
  onResolve: (confirmed: boolean) => void
}) {
  return (
    <Modal onClose={() => onResolve(false)} className="modal confirm-modal" labelledBy="confirm-title">
      <h2 id="confirm-title">{request.title ?? t.confirmTitle}</h2>
      <p class="confirm-message">{request.message}</p>
      <div class="confirm-actions">
        <button type="button" class="social-btn" onClick={() => onResolve(false)}>
          {t.cancel}
        </button>
        <button
          type="button"
          class={`social-btn ${request.danger ? 'danger-solid' : 'accent'}`}
          autofocus
          onClick={() => onResolve(true)}
        >
          {request.confirmLabel ?? t.confirmAction}
        </button>
      </div>
    </Modal>
  )
}

/**
 * `const [confirmUi, confirm] = useConfirm(t)` — await `confirm({...})` for a
 * boolean, and render `confirmUi` somewhere in the component.
 */
export function useConfirm(t: Messages): [ComponentChildren, (request: ConfirmRequest) => Promise<boolean>] {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const onResolve = (confirmed: boolean) => {
    setRequest(null)
    resolveRef.current?.(confirmed)
    resolveRef.current = null
  }

  const ui = request ? <ConfirmDialog t={t} request={request} onResolve={onResolve} /> : null
  return [ui, confirm]
}
