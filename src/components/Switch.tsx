/**
 * Accessible on/off switch row: label on the left, sliding knob on the
 * right. Used for mic-section options (noise reduction, mic monitoring).
 */
export function Switch({
  label,
  hint,
  checked,
  disabled = false,
  onToggle,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <div class="switch-row" title={hint}>
      <span class="switch-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        class={`switch${checked ? ' is-on' : ''}`}
        onClick={onToggle}
      >
        <span class="switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}
