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

          <div class="social-page-brand">
            <span class="social-page-brand-icon" aria-hidden="true">
              <Icon d={icons.users} size={18} />
            </span>
            <div class="social-page-brand-text">
              <h1>{t.social}</h1>
              <p>{signedIn ? t.groupsWithFriends : t.live}</p>
            </div>
          </div>

          <div class="social-page-header-actions">
            {!signedIn && (
              <button type="button" class="social-page-signin" onClick={onSignIn}>
                <Icon d={icons.user} size={16} />
                <span>{t.signIn}</span>
              </button>
            )}
          </div>
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
