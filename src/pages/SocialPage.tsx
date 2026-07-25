import { Router, route } from 'preact-router'
import type { ComponentChildren } from 'preact'
import { SocialChatApp } from '../components/socialchat/SocialChatApp'
import { GroupsLanding } from '../components/groups/GroupsLanding'
import { useSocialContext } from '../context/SocialContext'
import { Icon, icons } from '../components/icons'

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
  const { user, t } = useSocialContext()

  return (
    <div class="social-page">
      <div class="social-page-header">
        <button type="button" class="social-page-back" onClick={() => route('/', true)} aria-label={t.back}>
          <Icon d={icons.arrowLeft} />
          <span>{t.back}</span>
        </button>
        <h2>{t.social}</h2>
      </div>
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
