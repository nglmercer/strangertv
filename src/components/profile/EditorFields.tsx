import type { ComponentChildren } from 'preact'

/**
 * Reusable editor primitives. Shared by the section and link editors so
 * cards, fields, and rows render identical markup from one definition.
 * Class names match the existing editor stylesheet on purpose: swapping a
 * hand-written block for one of these components must not change the DOM.
 */

export function EditorCard({ children }: { children: ComponentChildren }) {
  return <article class="pedit-card">{children}</article>
}

export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="pedit-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Same as Field but a div, for controls that cannot live inside a label. */
export function FieldGroup({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="pedit-field">
      <span>{label}</span>
      {children}
    </div>
  )
}

export function FieldRow({ children }: { children: ComponentChildren }) {
  return <div class="pedit-row2">{children}</div>
}

export function TextField({
  label,
  value,
  maxLength,
  placeholder,
  onInput,
}: {
  label: string
  value: string
  maxLength?: number
  placeholder?: string
  onInput: (value: string) => void
}) {
  return (
    <Field label={label}>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </Field>
  )
}

export type SelectOption = { key: string; label: string }

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: ReadonlyArray<SelectOption>
  onChange: (key: string) => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((option) => (
          <option value={option.key} key={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
