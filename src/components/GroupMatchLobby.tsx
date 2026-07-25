import type { Messages } from '../i18n'
import type { GroupVisibility } from '../../shared/types'
import { Modal } from './Modal'

type Participant = {
  userId: number
  email?: string
}

export function GroupMatchLobby({
  t,
  roomId,
  visibility,
  participants,
  onStartQueue,
  onInvite,
  onClose,
}: {
  t: Messages
  roomId: string
  visibility: GroupVisibility
  participants: Participant[]
  onStartQueue: () => void
  onInvite: () => void
  onClose: () => void
}) {
  const canStart = visibility === 'private' || participants.length >= 2

  return (
    <Modal onClose={onClose} className="modal group-lobby" labelledBy="group-lobby-title">
      <button type="button" class="modal-close" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <h2 id="group-lobby-title">{t.groupMatchLobby ?? 'Group Match Lobby'}</h2>
      <div class="lobby-info">
        <span class={`badge ${visibility}`}>
          {visibility === 'public' ? (t.public ?? 'Public') : (t.private ?? 'Private')}
        </span>
        <span class="room-code">{roomId.slice(0, 12)}</span>
      </div>
      <div class="lobby-participants">
        <h3>{t.participants ?? 'Participants'} ({participants.length})</h3>
        <ul>
          {participants.map((p) => (
            <li key={p.userId}>
              <span class="participant-avatar">{p.email ? p.email[0].toUpperCase() : '?'}</span>
              <span class="participant-name">{p.email ? p.email.split('@')[0] : `User ${p.userId}`}</span>
            </li>
          ))}
        </ul>
      </div>
      <div class="lobby-actions">
        <button type="button" class="match" onClick={onInvite} disabled={!roomId}>
          {t.inviteFriends ?? 'Invite Friends'}
        </button>
        <button
          type="button"
          class="match full"
          onClick={onStartQueue}
          disabled={!canStart}
        >
          {t.startMatching ?? 'Start Matching'}
        </button>
      </div>
      {!canStart && visibility === 'public' && (
        <p class="lobby-hint">{t.groupNeedMoreParticipants ?? 'Invite at least 1 friend to start matching'}</p>
      )}
    </Modal>
  )
}
