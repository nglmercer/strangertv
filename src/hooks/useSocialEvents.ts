import { useEffect } from 'preact/hooks'
import type { Friend, Message, PublicUser } from '../../shared/types'

export type SocialEventHandlers = {
  onFriendRequest?: (from: PublicUser) => void
  onFriendAccepted?: (friend: Friend) => void
  onFriendDeclined?: (friendId: number) => void
  onFriendRemoved?: (friendId: number) => void
  onMessageNew?: (message: Message) => void
  onInvitation?: (invitationId: number, roomId: string, inviter: PublicUser) => void
}

type SocialWsMessage =
  | { type: 'friend:request'; friendId: number; from: PublicUser }
  | { type: 'friend:accepted'; friendId: number; from: PublicUser }
  | { type: 'friend:declined'; friendId: number }
  | { type: 'friend:removed'; friendId: number }
  | { type: 'message:new'; message: Message }
  | { type: 'invitation:send'; invitationId: number; roomId: string; inviter: PublicUser }

export function createSocialWsDispatch(handlers: SocialEventHandlers) {
  return (msg: SocialWsMessage) => {
    switch (msg.type) {
      case 'friend:request':
        handlers.onFriendRequest?.(msg.from)
        break
      case 'friend:accepted':
        handlers.onFriendAccepted?.({ id: msg.friendId, otherUser: msg.from } as Friend)
        break
      case 'friend:declined':
        handlers.onFriendDeclined?.(msg.friendId)
        break
      case 'friend:removed':
        handlers.onFriendRemoved?.(msg.friendId)
        break
      case 'message:new':
        handlers.onMessageNew?.(msg.message)
        break
      case 'invitation:send':
        handlers.onInvitation?.(msg.invitationId, msg.roomId, msg.inviter)
        break
    }
  }
}

export function useSocialEventBridge(
  onRawEvent: (msg: SocialWsMessage) => void,
) {
  useEffect(() => {
    // This hook is used inside components that have access to the WS.
    // The dispatch is called from the parent's WS message handler.
    return () => {}
  }, [onRawEvent])
}
