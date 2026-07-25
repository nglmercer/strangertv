import { Router } from 'preact-router'
import type { ComponentChildren } from 'preact'
import { SocialChatApp } from '../components/socialchat/SocialChatApp'
import { GroupsLanding } from '../components/groups/GroupsLanding'
import { useSocialContext } from '../context/SocialContext'

type RouterChildProps = {
  path?: string
  url?: string
  matches?: Record<string, string | undefined> | null
}

function SocialChatRoute(_props: RouterChildProps) {
  const { t, currentUserId, match } = useSocialContext()
  if (!currentUserId || !match) return null
  return <SocialChatApp t={t} currentUserId={currentUserId} match={match} />
}

function GroupsLandingRoute(_props: RouterChildProps) {
  const { t, onSignIn } = useSocialContext()
  return <GroupsLanding t={t} onSignIn={onSignIn} />
}

export function SocialPage() {
  const { user } = useSocialContext()

  return (
    <div class="social-page">
      <Router>
        {user ? (
          <SocialChatRoute path="/social" />
        ) : (
          <GroupsLandingRoute path="/social" />
        )}
      </Router>
    </div>
  )
}
