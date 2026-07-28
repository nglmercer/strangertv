import type { WebSocket } from 'ws'
import { db } from '../db'
import {
  getMeta,
  getPartner,
  getPartnerUserId,
  getRoom,
  getSocketUserId,
  getUserSocketDebug,
  heartbeat,
  leaveRoom,
  matchUsers,
  registerUserSocket,
  removeFromQueue,
  send,
  blockPair,
  getSocketForUser,
  getAllSocketsForUser,
  createGroupMatchRoom,
  getGroupRoom,
  getGroupRoomById,
  addParticipantToGroup,
  startGroupMatch,
  leaveGroup,
  type SocketLike,
  type GroupRoom,
} from '../matchmaking'
import { userFromToken, publicUser, type UserRow } from '../auth'
import {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  followUser,
  unfollowUser,
  sendInvitation,
  respondInvitation,
} from '../friends'
import { sendMessage, getConversation, hasRelationship } from '../messages'
import { sendGroupMessage, getGroupMembers, sendGroupInvite, respondGroupInvite, getGroupInvite } from '../groups'
import { noteReport } from '../alerts'
import { inc } from '../metrics'
import { rateLimit } from '../rateLimit'
import { config } from '../config'
import { logger } from '../logger'
import type { ClientMessage } from '../../shared/types'
import {
  GROUP_VISIBILITY,
  MATCH_MODE,
  MATCH_SCOPE,
  METRIC_NAMES,
  PEER_LEFT_REASON,
  SERVER_ERROR_CODE,
  WS_MESSAGE_TYPE,
} from '../../shared/constants'

function asSocket(ws: WebSocket): SocketLike {
  return ws as unknown as SocketLike
}

export interface WsState {
  draining: { value: boolean }
}

export function createWsHandler(state: WsState) {
  return async function handleWsMessage(ws: WebSocket, ip: string, sessionKey: string, raw: string) {
    const socket = asSocket(ws)
    let message: ClientMessage
    try {
      message = JSON.parse(raw) as ClientMessage
    } catch {
      return
    }

    if (message.type !== WS_MESSAGE_TYPE.queueHeartbeat && message.type !== WS_MESSAGE_TYPE.wsAuth) {
      if (message.type !== "telemetry:quality" && message.type !== "signal") {
      console.debug('[ws] recv', { type: message.type, raw: raw.slice(0, 200) })
      }
    }

    if (message.type === WS_MESSAGE_TYPE.queueHeartbeat) {
      heartbeat(socket)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.wsAuth) {
      if (message.token) {
        const user = await userFromToken(message.token)
        if (user) {
          registerUserSocket(user.id, socket)
          console.debug('[ws] auth', { userId: user.id })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.queueJoin || message.type === WS_MESSAGE_TYPE.roomNext) {
      if (state.draining.value) {
        send(socket, { type: WS_MESSAGE_TYPE.serverDraining, message: 'Server is restarting. Try again shortly.' })
        return
      }
      if (!rateLimit(`wsjoin:${ip}`, 40, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down.' })
        return
      }
      if (await isBanned(null, ip)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
        return
      }
      if (!config.features.anonymousMatch && !message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to match.' })
        return
      }
      const prefs = normalizePreferences(message.preferences)
      if (!prefs) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Invalid preferences.' })
        return
      }
      if (prefs.mode === 'group') {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Use group-match:create to start group matching.' })
        return
      }
      let userId: number | undefined
      let userEmail: string | undefined
      if (message.token) {
        const user = await userFromToken(message.token)
        if (user) {
          if (await isBanned(user.id, ip)) {
            send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.banned, message: 'Access denied.' })
            return
          }
          if (config.features.requireEmailVerified && !user.email_verified) {
            send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.emailUnverified, message: 'Verify your email first.' })
            return
          }
          userId = user.id
          userEmail = user.email
        }
      }
      if (message.type === WS_MESSAGE_TYPE.roomNext) {
        console.debug('[ws] room:next', { userId })
        leaveRoom(socket, true, PEER_LEFT_REASON.next)
        inc(METRIC_NAMES.roomNext)
      }
      joinQueue(socket, prefs, { userId, email: userEmail, sessionKey })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.queueLeave || message.type === WS_MESSAGE_TYPE.roomLeave) {
      removeFromQueue(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.leave)
      return
    }

    // Group match: create a group room
    if (message.type === WS_MESSAGE_TYPE.groupMatchCreate) {
      if (!message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to create group matches.' })
        return
      }
      const user = await userFromToken(message.token)
      if (!user) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Invalid token.' })
        return
      }
      const visibility = message.visibility === GROUP_VISIBILITY.private ? GROUP_VISIBILITY.private : GROUP_VISIBILITY.public
      const prefs = normalizePreferences(message.preferences)
      if (!prefs) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Invalid preferences.' })
        return
      }
      const mode = prefs.mode === MATCH_MODE.group ? MATCH_MODE.group : MATCH_MODE.solo
      const roomId = createGroupMatchRoom(socket, visibility, { ...prefs, mode, matchScope: prefs.matchScope }, {
        userId: user.id,
        email: user.email,
        sessionKey,
      })
      return
    }

    // Group match: create group AND invite target user atomically (no race condition)
    if (message.type === WS_MESSAGE_TYPE.groupMatchCreateAndInvite) {
      if (!message.token) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to create group matches.' })
        return
      }
      const user = await userFromToken(message.token)
      if (!user) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Invalid token.' })
        return
      }
      const partnerSocket = getPartner(socket)
      const visibility = GROUP_VISIBILITY.private
      const prefs = normalizePreferences(message.preferences) || {
        country: 'any', language: 'any', gender: 'any', lookingFor: 'any',
        interests: [], allowMatchWithSameUsers: true, mode: MATCH_MODE.group, matchScope: MATCH_SCOPE.all,
      }
      const roomId = createGroupMatchRoom(socket, visibility, { ...prefs, mode: MATCH_MODE.group, matchScope: prefs.matchScope }, {
        userId: user.id,
        email: user.email,
        sessionKey,
        skipLeaveRoom: true,
      })
      const targetSockets = message.userId ? getAllSocketsForUser(message.userId) : []
      if (targetSockets.length === 0 && partnerSocket) targetSockets.push(partnerSocket)
      if (targetSockets.length > 0) {
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [user.id] })
        const inviterProfile = inviterRow.rows[0]
        const inviteMsg = {
          type: WS_MESSAGE_TYPE.groupMatchInviteReceived,
          roomId,
          host: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: user.id, email: '' },
        }
        for (const s of targetSockets) send(s, inviteMsg)
        setTimeout(() => {
          const group = getGroupRoomById(roomId)
          if (group && group.participants.size < 2) {
            send(socket, { type: WS_MESSAGE_TYPE.groupMatchInviteDeclined, roomId })
            leaveGroup(socket, PEER_LEFT_REASON.userLeft)
          }
        }, 30_000)
      }
      return
    }

    // Group match: invite a friend to join the group
    if (message.type === WS_MESSAGE_TYPE.groupMatchInvite) {
      const meta = getMeta(socket)
      let inviterId = meta?.userId
      if (!inviterId && message.token) {
        const user = await userFromToken(message.token)
        if (user) inviterId = user.id
      }
      if (!inviterId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to invite.' })
        return
      }
      const group = getGroupRoom(socket)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'No group room.' })
        return
      }
      const targetSocket = getSocketForUser(message.userId)
      if (!targetSocket) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'User is not online.' })
        return
      }
      const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [inviterId] })
      const inviterProfile = inviterRow.rows[0]
      send(targetSocket, {
        type: WS_MESSAGE_TYPE.groupMatchInviteReceived,
        roomId: group.id,
        host: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: inviterId, email: '' },
      })
      send(socket, { type: WS_MESSAGE_TYPE.groupMatchInviteSent, userId: message.userId })
      return
    }

    // Group match: join a group room (accepting invite)
    if (message.type === WS_MESSAGE_TYPE.groupMatchJoin) {
      let userId: number | undefined
      let email: string | undefined
      if (message.token) {
        const user = await userFromToken(message.token)
        if (user) {
          userId = user.id
          email = user.email
        }
      }
      const group = getGroupRoomById(message.roomId)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Group not found.' })
        return
      }
      leaveRoom(group.hostSocket, true, PEER_LEFT_REASON.groupInvite)
      leaveRoom(socket, false, PEER_LEFT_REASON.groupInvite)
      const prefs = normalizePreferences(group.preferences)
      if (!prefs) return
      addParticipantToGroup(group, socket, {
        userId,
        email,
        preferences: prefs,
        sessionKey,
      })
      return
    }

    // Group match: decline invite
    if (message.type === WS_MESSAGE_TYPE.groupMatchInviteDecline) {
      const group = getGroupRoomById(message.roomId)
      if (group) {
        send(group.hostSocket, { type: WS_MESSAGE_TYPE.groupMatchInviteDeclined, roomId: message.roomId })
        leaveGroup(group.hostSocket, PEER_LEFT_REASON.userLeft)
      }
      return
    }

    // Group match: start matching (enter queue)
    if (message.type === WS_MESSAGE_TYPE.groupMatchStart) {
      const group = getGroupRoomById(message.roomId)
      if (!group) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'Group not found.' })
        return
      }
      startGroupMatch(group)
      return
    }

    // Group match: leave group
    if (message.type === WS_MESSAGE_TYPE.groupMatchLeave) {
      removeFromQueue(socket)
      leaveGroup(socket, PEER_LEFT_REASON.userLeft)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.signal) {
      const partner = getPartner(socket)
      if (partner && message.payload) {
        send(partner, { type: WS_MESSAGE_TYPE.signal, payload: message.payload })
        inc(METRIC_NAMES.signalsRelayed)
      } else {
        const group = getGroupRoom(socket)
        if (group && message.payload) {
          const senderUserId = group.participants.get(socket)?.userId ?? getSocketUserId(socket)
          const msgAsAny = message as unknown as { targetUserId?: number }
          const targetId = msgAsAny.targetUserId
          let relayed = false
          if (targetId) {
            for (const [sock, p] of group.participants) {
              if (p.userId === targetId && sock !== socket) {
                send(sock, { type: WS_MESSAGE_TYPE.signal, payload: message.payload, targetUserId: senderUserId })
                relayed = true
                break
              }
            }
          } else {
            for (const [sock] of group.participants) {
              if (sock !== socket) {
                send(sock, { type: WS_MESSAGE_TYPE.signal, payload: message.payload, targetUserId: senderUserId })
                relayed = true
              }
            }
          }
          if (relayed) inc(METRIC_NAMES.signalsRelayed)
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.chat) {
      if (!rateLimit(`wschat:${ip}`, 30, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down chat.' })
        return
      }
      const meta = getMeta(socket)
      const partner = getPartner(socket)
      const partnerId = getPartnerUserId(socket)
      const text = message.payload?.text?.slice(0, 500)
      const time = message.payload?.time || new Date().toISOString()
      if (partner && text) {
        send(partner, {
          type: WS_MESSAGE_TYPE.chat,
          payload: { text, time },
        })
        inc(METRIC_NAMES.chatsRelayed)
        if (meta?.userId && partnerId && (await hasRelationship(meta.userId, partnerId))) {
          await sendMessage(meta.userId, partnerId, text)
        }
      } else {
        const group = getGroupRoom(socket)
        if (group && text) {
          for (const [sock] of group.participants) {
            if (sock !== socket) {
              send(sock, {
                type: WS_MESSAGE_TYPE.chat,
                payload: { text, time },
              })
            }
          }
          inc(METRIC_NAMES.chatsRelayed)
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.report) {
      if (!rateLimit(`wsreport:${ip}`, 10, 60_000)) return
      if (!config.features.guestReports) {
        const meta = getMeta(socket)
        if (!meta?.userId) {
          send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to report.' })
          return
        }
      }
      const room = getRoom(socket)
      const meta = getMeta(socket)
      await db.execute({
        sql: 'INSERT INTO reports (reporter_id, reporter_session, room_id, reason, detail) VALUES (?, ?, ?, ?, ?)',
        args: [
          meta?.userId ?? null,
          sessionKey,
          room?.id ?? null,
          message.reason,
          message.detail?.slice(0, 500) ?? null,
        ],
      })
      inc(METRIC_NAMES.reportsTotal)
      void noteReport(message.reason)
      const partner = getPartner(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.reported)
      send(socket, { type: WS_MESSAGE_TYPE.reportAck })
      if (partner) leaveRoom(partner, false)
      return
    }

    if (message.type === WS_MESSAGE_TYPE.block) {
      const meta = getMeta(socket)
      const peerId = getPartnerUserId(socket)
      if (meta?.userId && peerId) {
        await db.execute({
          sql: 'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)',
          args: [meta.userId, peerId],
        })
        blockPair(meta.userId, peerId)
        inc(METRIC_NAMES.blocksTotal)
      }
      const partner = getPartner(socket)
      leaveRoom(socket, true, PEER_LEFT_REASON.blocked)
      send(socket, { type: WS_MESSAGE_TYPE.blockAck })
      if (partner) leaveRoom(partner, false)
      return
    }

    // Friend system WS handlers
    if (message.type === WS_MESSAGE_TYPE.friendRequest) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send friend requests.' })
        return
      }
      const targetSocket = getSocketForUser(message.userId)
      if (!targetSocket) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'User is not online.' })
        return
      }
      await sendFriendRequest(userId, message.userId)
      const fromRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [userId] })
      const fromProfile = fromRow.rows[0]
      send(targetSocket, { type: WS_MESSAGE_TYPE.friendRequest, friendId: userId, from: fromProfile ? publicUser(fromProfile as unknown as UserRow) : { id: userId, email: '' } })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendAccept) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) return
      await respondFriendRequest(message.friendId, userId, 'accept')
      const friend = await db.execute({ sql: 'SELECT user_a_id, user_b_id FROM friends WHERE id = ?', args: [message.friendId] })
      const row = friend.rows[0]
      if (row) {
        const otherId = Number(row.user_a_id) === userId ? Number(row.user_b_id) : Number(row.user_a_id)
        const otherSocket = getSocketForUser(otherId)
        if (otherSocket) {
          const otherRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [otherId] })
          const otherProfile = otherRow.rows[0]
          send(otherSocket, { type: WS_MESSAGE_TYPE.friendAccepted, friendId: message.friendId, from: otherProfile ? publicUser(otherProfile as unknown as UserRow) : { id: otherId, email: '' } })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendDecline) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) return
      await respondFriendRequest(message.friendId, userId, 'decline')
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendRemove) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) return
      await removeFriend(message.friendId, userId)
      return
    }

    // Follow system WS handlers
    if (message.type === WS_MESSAGE_TYPE.follow) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to follow.' })
        return
      }
      await followUser(userId, message.userId)
      const targetSocket = getSocketForUser(message.userId)
      if (targetSocket) {
        const followedRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [userId] })
        const followedProfile = followedRow.rows[0]
        send(targetSocket, { type: WS_MESSAGE_TYPE.followConfirm, followed: followedProfile ? publicUser(followedProfile as unknown as UserRow) : { id: userId, email: '' } })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.unfollow) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) return
      await unfollowUser(userId, message.userId)
      return
    }

    // Invitation system WS handlers
    if (message.type === WS_MESSAGE_TYPE.invitationSend) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      console.debug('[ws] invitation:send', { from: userId, to: message.userId, roomId: message.roomId })
      if (!userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send invitations.' })
        return
      }
      const { invitationId } = await sendInvitation(userId, message.userId, message.roomId)
      const targetSocket = getSocketForUser(message.userId)
      const targetDebug = getUserSocketDebug(message.userId)
      console.debug('[ws] invitation:send target', {
        targetOnline: !!targetSocket,
        targetUserId: message.userId,
        invitationId,
        targetSocketCount: targetDebug.count,
        targetSocketReadyStates: targetDebug.readyStates,
        senderSocketReadyState: socket.readyState,
      })
      if (targetSocket) {
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [userId] })
        const inviterProfile = inviterRow.rows[0]
        const payload = { type: WS_MESSAGE_TYPE.invitationSend, invitationId, roomId: message.roomId, inviter: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: userId, email: '' } }
        console.debug('[ws] invitation:send delivering', { payload })
        send(targetSocket, payload)
        console.debug('[ws] invitation:send delivered')
      } else {
        console.debug('[ws] invitation:send target offline, stored for later')
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationAccept) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      console.debug('[ws] invitation:accept recv', { userId, invitationId: message.invitationId })
      if (!userId) return
      try {
        const invitation = await db.execute({ sql: 'SELECT inviter_id, room_id FROM invitations WHERE id = ?', args: [message.invitationId] })
        const row = invitation.rows[0] as unknown as { inviter_id: number; room_id: string } | undefined
        console.debug('[ws] invitation:accept row', { row })
        await respondInvitation(message.invitationId, userId, 'accept')
        if (row) {
          const matched = await matchUsers(row.inviter_id, userId)
          console.debug('[ws] invitation:accept matched', { matched, inviterId: row.inviter_id, userId })
          const inviterSocket = getSocketForUser(row.inviter_id)
          if (inviterSocket) {
            send(inviterSocket, { type: WS_MESSAGE_TYPE.invitationAccepted, invitationId: message.invitationId, roomId: row.room_id })
          }
        }
      } catch (err) {
        logger.error('invitation.accept.error', { err, invitationId: message.invitationId, userId })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationDecline) {
      const userId = getSocketUserId(socket) || getMeta(socket)?.userId
      if (!userId) return
      try {
        const invitation = await db.execute({ sql: 'SELECT inviter_id FROM invitations WHERE id = ?', args: [message.invitationId] })
        const row = invitation.rows[0] as unknown as { inviter_id: number } | undefined
        await respondInvitation(message.invitationId, userId, 'decline')
        if (row) {
          const inviterSocket = getSocketForUser(row.inviter_id)
          if (inviterSocket) {
            send(inviterSocket, { type: WS_MESSAGE_TYPE.invitationDeclined, invitationId: message.invitationId })
          }
        }
      } catch (err) {
        logger.error('invitation.decline.error', { err, invitationId: message.invitationId, userId })
      }
      return
    }

    // Messages WS handlers
    if (message.type === WS_MESSAGE_TYPE.messageSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send messages.' })
        return
      }
      if (!rateLimit(`wsmsg:${meta.userId}`, 30, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down messages.' })
        return
      }
      const friendId = Number(message.friendId)
      const text = String(message.text ?? '').slice(0, 500)
      if (!friendId || !text) return
      if (!(await hasRelationship(meta.userId, friendId))) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'No relationship.' })
        return
      }
      const msg = await sendMessage(meta.userId, friendId, text)
      if (friendId !== meta.userId) {
        const targetSocket = getSocketForUser(friendId)
        if (targetSocket) {
          send(targetSocket, { type: WS_MESSAGE_TYPE.messageNew, message: msg })
        }
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.messageHistory) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const friendId = Number(message.friendId)
      if (!friendId) return
      if (!(await hasRelationship(meta.userId, friendId))) return
      const limit = Math.min(Number(message.limit) || 50, 100)
      const beforeId = message.beforeId ? Number(message.beforeId) : undefined
      const messages = await getConversation(meta.userId, friendId, limit, beforeId)
      send(socket, { type: WS_MESSAGE_TYPE.messageHistory, friendId, messages })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupMessageSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const { groupId, text } = message as { groupId: number; text: string }
      if (!groupId || !text?.trim()) return
      const sentMessage = await sendGroupMessage(groupId, meta.userId, text)
      const members = await getGroupMembers(groupId)
      for (const member of members) {
        const targetSocket = getSocketForUser(member.userId)
        if (targetSocket) {
          send(targetSocket, { type: WS_MESSAGE_TYPE.groupMessageNew, message: sentMessage })
        }
      }
      return
    }

    // Group invite WS handlers
    if (message.type === WS_MESSAGE_TYPE.groupInviteSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to invite.' })
        return
      }
      if (!rateLimit(`wsginvite:${meta.userId}`, 10, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down invites.' })
        return
      }
      try {
        const invite = await sendGroupInvite(message.groupId, meta.userId, message.userId)
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const inviterProfile = inviterRow.rows[0]
        const targetSocket = getSocketForUser(message.userId)
        if (targetSocket) {
          send(targetSocket, {
            type: 'group:invite',
            inviteId: invite.id,
            groupId: invite.groupId,
            groupName: invite.groupName,
            inviter: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: meta.userId, email: '' },
          })
        }
      } catch (err) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: err instanceof Error ? err.message : 'Invite failed.' })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupInviteAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      try {
        const result = await respondGroupInvite(message.inviteId, meta.userId, 'accept')
        const invite = await getGroupInvite(message.inviteId)
        if (invite) {
          const accepterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
          const accepterProfile = accepterRow.rows[0]
          const inviterSocket = getSocketForUser(result.inviterId)
          if (inviterSocket) {
            send(inviterSocket, {
              type: 'group:invite:accepted',
              inviteId: message.inviteId,
              groupId: result.groupId,
              userId: meta.userId,
            })
          }
        }
      } catch {
        /* ignore */
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.groupInviteDecline) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      try {
        const result = await respondGroupInvite(message.inviteId, meta.userId, 'decline')
        const declinerRow = await db.execute({ sql: 'SELECT id, email FROM users WHERE id = ?', args: [meta.userId] })
        const declinerProfile = declinerRow.rows[0]
        const inviterSocket = getSocketForUser(result.inviterId)
        if (inviterSocket) {
          send(inviterSocket, {
            type: 'group:invite:declined',
            inviteId: message.inviteId,
            groupId: result.groupId,
            userId: meta.userId,
          })
        }
      } catch {
        /* ignore */
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.telemetryQuality) {
      if (!config.features.qualityTelemetry) return
      if (!rateLimit(`telemetry:${ip}`, 60, 60_000)) return
      inc(METRIC_NAMES.webrtcQuality(message.quality))
      logger.debug('webrtc.quality', {
        roomId: message.roomId,
        quality: message.quality,
        ice: message.iceState,
        conn: message.connectionState,
      })
    }

    if (message.type === WS_MESSAGE_TYPE.telemetryQuality) {
      if (!config.features.qualityTelemetry) return
      if (!rateLimit(`telemetry:${ip}`, 60, 60_000)) return
      inc(METRIC_NAMES.webrtcQuality(message.quality))
      logger.debug('webrtc.quality', {
        roomId: message.roomId,
        quality: message.quality,
        ice: message.iceState,
        conn: message.connectionState,
      })
    }
  }
}

// Re-export helpers that are used inside the handler
import { isBanned } from '../auth'
import { normalizePreferences, joinQueue } from '../matchmaking'
