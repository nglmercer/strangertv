import { route } from 'preact-router'
import { SocialChatApp } from '../components/socialchat/SocialChatApp'
import { GroupsLanding } from '../components/groups/GroupsLanding'
import { useSocialContext } from '../context/SocialContext'
import { Icon, icons } from '../components/icons'

export function SocialPage() {
  const { user, t, currentUserId, match, onSignIn } = useSocialContext()

  return (
    <div class="social-page">
      <div class="social-page-header">
        <button type="button" class="social-page-back" onClick={() => route('/', true)} aria-label={t.back}>
          <Icon d={icons.arrowLeft} />
          <span>{t.back}</span>
        </button>
        <h2>{t.social}</h2>
      </div>
      {user && currentUserId ? (
        <SocialChatApp t={t} currentUserId={currentUserId} match={match} />
      ) : (
        <GroupsLanding t={t} onSignIn={onSignIn} />
      )}
    </div>
  )
}
