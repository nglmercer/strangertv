import { Router } from 'preact-router'
import { SocialChatApp } from '../components/socialchat/SocialChatApp'
import { GroupsLanding } from '../components/groups/GroupsLanding'
import { useSocialContext } from '../context/SocialContext'

export function SocialPage() {
  const { user, t, currentUserId, match, onSignIn } = useSocialContext()

  return (
    <div class="social-page">
      <Router>
        {user && currentUserId && match ? (
          <SocialChatApp path="/social" t={t} currentUserId={currentUserId} match={match} />
        ) : (
          <GroupsLanding path="/social" t={t} onSignIn={onSignIn} />
        )}
      </Router>
    </div>
  )
}
