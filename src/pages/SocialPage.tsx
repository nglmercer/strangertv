import { route } from 'preact-router'
import { Icon, icons } from '../components/icons'
import { SocialApp } from '../components/social/SocialApp'
import { SignedOut } from '../components/social/SignedOut'
import { NotificationCenter } from '../components/socialchat/NotificationCenter'
import { useSocialContext } from '../context/SocialContext'

export function SocialPage() {
  const { user, t, currentUserId, match, onSignIn } = useSocialContext()
  const signedIn = Boolean(user && currentUserId)

  return (
    <div class={`social-page${signedIn ? ' is-signed-in' : ''}`}>
      <header class="social-page-header">
        <button type="button" class="social-page-back" onClick={() => route('/', true)}>
          <Icon d={icons.arrowLeft} size={18} />
          <span>{t.back}</span>
        </button>
        <h1 class="social-page-title">{t.social}</h1>
        <div class="social-page-header-end">
          <NotificationCenter
            t={t}
            onAccept={(invitationId, roomId) => match?.invitationAccept(invitationId, roomId)}
            onDecline={(invitationId) => match?.invitationDecline(invitationId)}
          />
        </div>
      </header>

      <div class="social-page-body">
        {signedIn ? (
          <SocialApp t={t} currentUserId={currentUserId!} match={match} />
        ) : (
          <SignedOut t={t} onSignIn={onSignIn} />
        )}
      </div>
    </div>
  )
}
