import { useState } from 'preact/hooks'
import { Icon, icons } from '../icons'
import { EditorCard, TextField } from './EditorFields'
import { normalizeUsername, validateUsername } from './username'

/**
 * Profile address card: shows `/u/:username` with a change form.
 * `onRename` persists the normalized name and returns a server error
 * message, or null on success (the parent then routes to the new handle).
 */
export function UsernameCard({
  username,
  onRename,
}: {
  username: string
  onRename: (name: string) => Promise<string | null>
}) {
  const [editing, setEditing] = useState(username === '')
  const [value, setValue] = useState(username)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const name = normalizeUsername(value)
    const invalid = validateUsername(name)
    if (invalid) {
      setError(invalid)
      return
    }
    if (name === username) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const failed = await onRename(name)
    setSaving(false)
    if (failed) setError(failed)
  }

  return (
    <EditorCard>
      <div class="pedit-summary">
        <span class="pedit-sumicon" aria-hidden="true">
          <Icon d={icons.share} size={18} />
        </span>
        <span class="pedit-summeta">
          <span class="pedit-sumtitle">Profile address</span>
          <span class="pedit-path">{username ? `/u/${username}` : 'Not claimed yet'}</span>
        </span>
        {!editing && (
          <button
            type="button"
            class="pedit-btn"
            onClick={() => {
              setValue(username)
              setError(null)
              setEditing(true)
            }}
          >
            <span>Change</span>
          </button>
        )}
      </div>
      {editing && (
        <>
          <div class="pedit-rename">
            <TextField
              label="Username"
              value={value}
              maxLength={20}
              placeholder="username"
              onInput={(v) => setValue(v)}
            />
          </div>
          {error && (
            <p class="pedit-error" role="alert">
              {error}
            </p>
          )}
          <div class="pedit-rename-actions">
            <button
              type="button"
              class="pedit-btn primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              class="pedit-btn"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </EditorCard>
  )
}
