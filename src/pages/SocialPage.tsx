import { route } from 'preact-router'
import { SocialChatApp } from '../components/socialchat/SocialChatApp'
import { GroupsLanding } from '../components/groups/GroupsLanding'
import { useSocialContext } from '../context/SocialContext'
import { Icon, icons } from '../components/icons'

export function SocialPage() {
  const { user, t, currentUserId, match, onSignIn } = useSocialContext()
  const signedIn = Boolean(user && currentUserId)

  return (
    <div class={`social-page${signedIn ? ' is-signed-in' : ''}`}>
      <header class="social-page-header">
        <div class="social-page-header-inner">
          <button
            type="button"
            class="social-page-back"
            onClick={() => route('/', true)}
            aria-label={t.back}
          >
            <Icon d={icons.arrowLeft} size={18} />
            <span>{t.back}</span>
          </button>
          <h1 class="social-page-title">{t.social}</h1>
          <div class="social-page-header-spacer" aria-hidden="true" />
        </div>
      </header>

      <div class="social-page-body">
        {signedIn ? (
          <SocialChatApp t={t} currentUserId={currentUserId!} match={match} />
        ) : (
          <GroupsLanding t={t} onSignIn={onSignIn} />
        )}
      </div>
    </div>
  )
}
