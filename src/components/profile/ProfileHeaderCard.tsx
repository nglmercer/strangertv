import { EditorCard, TextField } from './EditorFields'
import type { ProfileHeaderDraft } from './linksStore'

/**
 * Header identity card: the display name, bio, and website rendered on the
 * public profile. Controlled; the parent autosaves on change. Lengths match
 * the server caps so the PUT never 400s on these fields.
 */
export function ProfileHeaderCard({
  value,
  onChange,
}: {
  value: ProfileHeaderDraft
  onChange: (next: ProfileHeaderDraft) => void
}) {
  return (
    <EditorCard>
      <p class="pedit-section-title">Profile</p>
      <TextField
        label="Display name"
        value={value.displayName}
        maxLength={40}
        placeholder="Ada Lovelace"
        onInput={(displayName) => onChange({ ...value, displayName })}
      />
      <TextField
        label="Bio"
        value={value.bio}
        maxLength={160}
        placeholder="What should visitors know?"
        onInput={(bio) => onChange({ ...value, bio })}
      />
      <TextField
        label="Website"
        value={value.website}
        maxLength={120}
        placeholder="example.com"
        onInput={(website) => onChange({ ...value, website })}
      />
    </EditorCard>
  )
}
