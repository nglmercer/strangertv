import { useState } from 'preact/hooks'
import type { Messages } from '../../i18n'
import type { useMatchSocket } from '../../hooks/useMatchSocket'
import { useSocialData, type ChatId } from '../../hooks/useSocialData'
import { icons } from '../icons'
import { GroupInviteModal } from '../socialchat/GroupInviteModal'
import { ChatPane } from './ChatPane'
import { ConversationList } from './ConversationList'
import { CreateGroupModal } from './CreateGroupModal'
import { GroupSheet } from './GroupSheet'
import { PeoplePanel } from './PeoplePanel'
import { EmptyState } from './States'

type MatchSocket = ReturnType<typeof useMatchSocket>

/**
 * Social section shell: conversation pane on the left, the open conversation on
 * the right, and an optional group-info sheet. On narrow screens the two panes
 * swap (`has-chat` shows the thread, the back arrow returns to the list).
 */
export function SocialApp({
  t,
  currentUserId,
  match,
}: {
  t: Messages
  currentUserId: number
  match: MatchSocket | null
}) {
  const data = useSocialData(currentUserId)
  const [tab, setTab] = useState<'chats' | 'people'>('chats')
  const [creating, setCreating] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [invitingFriendId, setInvitingFriendId] = useState<number | null>(null)

  const open = (chat: ChatId) => {
    data.openChat(chat)
    setInfoOpen(false)
    setTab('chats')
  }

  const requestCount = data.incoming.length + data.invites.length

  return (
    <div class={`social-app ${data.active ? 'has-chat' : ''} ${infoOpen ? 'has-info' : ''}`}>
      <ConversationList
        t={t}
        groups={data.groups}
        friends={data.friends}
        active={data.active}
        state={data.rosterState}
        requestCount={requestCount}
        tab={tab}
        onTabChange={setTab}
        onOpen={open}
        onCreateGroup={() => setCreating(true)}
        onRetry={() => void data.reloadRoster()}
        people={
          <PeoplePanel
            t={t}
            friends={data.friends}
            incoming={data.incoming}
            outgoing={data.outgoing}
            invites={data.invites}
            state={data.rosterState}
            currentUserId={currentUserId}
            onOpenChat={open}
            onRespondFriend={data.respondFriend}
            onRespondInvite={data.respondGroupInvite}
            onRemoveFriend={data.removeFriend}
            onRetry={() => void data.reloadRoster()}
          />
        }
      />

      {data.active && (data.activeGroup || data.activeFriend) ? (
        <ChatPane
          t={t}
          chat={data.active}
          group={data.activeGroup}
          friend={data.activeFriend}
          memberCount={data.members.length || data.activeGroup?.memberCount || 0}
          messages={data.messages}
          messagesState={data.messagesState}
          currentUserId={currentUserId}
          infoOpen={infoOpen}
          onBack={() => {
            data.openChat(null)
            setInfoOpen(false)
          }}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          onInviteToGroup={data.activeFriend ? () => setInvitingFriendId(data.activeFriend!.otherUser.id) : undefined}
          onSend={data.send}
          onRetry={() => void data.reloadMessages()}
        />
      ) : (
        <section class="chat-pane empty">
          <EmptyState icon={icons.chatBubble} title={t.chooseConversation} hint={t.chooseConversationHint} />
        </section>
      )}

      {infoOpen && data.activeGroup && (
        <GroupSheet
          t={t}
          group={data.activeGroup}
          members={data.members}
          membersState={data.membersState}
          friends={data.friends}
          currentUserId={currentUserId}
          onClose={() => setInfoOpen(false)}
          onAddMembers={(ids) => data.addMembers(data.activeGroup!.id, ids)}
          onRemoveMember={(id) => data.removeMember(data.activeGroup!.id, id)}
          onRename={(name) => data.renameGroup(data.activeGroup!.id, name)}
          onLeave={async () => {
            await data.leaveGroup(data.activeGroup!.id)
            setInfoOpen(false)
          }}
          onRetry={() => void data.reloadRoster()}
        />
      )}

      {creating && (
        <CreateGroupModal
          t={t}
          friends={data.friends}
          onClose={() => setCreating(false)}
          onCreate={async (name, ids) => {
            await data.createGroup(name, ids)
            setCreating(false)
          }}
        />
      )}

      {invitingFriendId != null && (
        <GroupInviteModal
          t={t}
          groups={data.groups}
          friendName={data.activeFriend ? data.activeFriend.otherUser.email.split('@')[0] ?? '' : ''}
          onSelect={(groupId) => {
            match?.groupInvite(groupId, invitingFriendId)
            setInvitingFriendId(null)
          }}
          onClose={() => setInvitingFriendId(null)}
        />
      )}
    </div>
  )
}
