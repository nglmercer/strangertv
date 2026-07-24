import type { WebSocket } from 'ws'
import { db } from '../db'
import {
  getMeta,
  getPartner,
  getPartnerUserId,
  getRoom,
  heartbeat,
  leaveRoom,
  removeFromQueue,
  send,
  blockPair,
  getSocketForUser,
  type SocketLike,
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
import { sendMessage, getConversation, areFriends } from '../messages'
import { noteReport } from '../alerts'
import { inc } from '../metrics'
import { rateLimit } from '../rateLimit'
import { config } from '../config'
import { logger } from '../logger'
import type { ClientMessage } from '../../shared/types'
import {
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

    if (message.type === WS_MESSAGE_TYPE.queueHeartbeat) {
      heartbeat(socket)
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

    if (message.type === WS_MESSAGE_TYPE.signal) {
      const partner = getPartner(socket)
      if (partner && message.payload) {
        send(partner, { type: WS_MESSAGE_TYPE.signal, payload: message.payload })
        inc(METRIC_NAMES.signalsRelayed)
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.chat) {
      if (!rateLimit(`wschat:${ip}`, 30, 60_000)) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.rateLimit, message: 'Slow down chat.' })
        return
      }
      const partner = getPartner(socket)
      const text = message.payload?.text?.slice(0, 500)
      if (partner && text) {
        send(partner, {
          type: WS_MESSAGE_TYPE.chat,
          payload: { text, time: message.payload.time || new Date().toISOString() },
        })
        inc(METRIC_NAMES.chatsRelayed)
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
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send friend requests.' })
        return
      }
      const targetSocket = getSocketForUser(message.userId)
      if (!targetSocket) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.badPrefs, message: 'User is not online.' })
        return
      }
      await sendFriendRequest(meta.userId, message.userId)
      const fromRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
      const fromProfile = fromRow.rows[0]
      send(targetSocket, { type: WS_MESSAGE_TYPE.friendRequest, friendId: meta.userId, from: fromProfile ? publicUser(fromProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondFriendRequest(message.friendId, meta.userId, 'accept')
      const friend = await db.execute({ sql: 'SELECT user_a_id, user_b_id FROM friends WHERE id = ?', args: [message.friendId] })
      const row = friend.rows[0]
      if (row) {
        const otherId = Number(row.user_a_id) === meta.userId ? Number(row.user_b_id) : Number(row.user_a_id)
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
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondFriendRequest(message.friendId, meta.userId, 'decline')
      return
    }

    if (message.type === WS_MESSAGE_TYPE.friendRemove) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await removeFriend(message.friendId, meta.userId)
      return
    }

    // Follow system WS handlers
    if (message.type === WS_MESSAGE_TYPE.follow) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to follow.' })
        return
      }
      await followUser(meta.userId, message.userId)
      const targetSocket = getSocketForUser(message.userId)
      if (targetSocket) {
        const followedRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const followedProfile = followedRow.rows[0]
        send(targetSocket, { type: WS_MESSAGE_TYPE.followConfirm, followed: followedProfile ? publicUser(followedProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.unfollow) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await unfollowUser(meta.userId, message.userId)
      return
    }

    // Invitation system WS handlers
    if (message.type === WS_MESSAGE_TYPE.invitationSend) {
      const meta = getMeta(socket)
      if (!meta?.userId) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Sign in to send invitations.' })
        return
      }
      await sendInvitation(meta.userId, message.userId, message.roomId)
      const targetSocket = getSocketForUser(message.userId)
      if (targetSocket) {
        const inviterRow = await db.execute({ sql: 'SELECT id, email, birth_date, gender, country, language, interests, email_verified FROM users WHERE id = ?', args: [meta.userId] })
        const inviterProfile = inviterRow.rows[0]
        send(targetSocket, { type: WS_MESSAGE_TYPE.invitationSend, invitationId: 0, roomId: message.roomId, inviter: inviterProfile ? publicUser(inviterProfile as unknown as UserRow) : { id: meta.userId, email: '' } })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationAccept) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondInvitation(message.invitationId, meta.userId, 'accept')
      return
    }

    if (message.type === WS_MESSAGE_TYPE.invitationDecline) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      await respondInvitation(message.invitationId, meta.userId, 'decline')
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
      if (friendId === meta.userId) return
      if (!(await areFriends(meta.userId, friendId))) {
        send(socket, { type: WS_MESSAGE_TYPE.error, code: SERVER_ERROR_CODE.authRequired, message: 'Not friends.' })
        return
      }
      const msg = await sendMessage(meta.userId, friendId, text)
      const targetSocket = getSocketForUser(friendId)
      if (targetSocket) {
        send(targetSocket, { type: WS_MESSAGE_TYPE.messageNew, message: msg })
      }
      return
    }

    if (message.type === WS_MESSAGE_TYPE.messageHistory) {
      const meta = getMeta(socket)
      if (!meta?.userId) return
      const friendId = Number(message.friendId)
      if (!friendId) return
      if (!(await areFriends(meta.userId, friendId))) return
      const limit = Math.min(Number(message.limit) || 50, 100)
      const beforeId = message.beforeId ? Number(message.beforeId) : undefined
      const messages = await getConversation(meta.userId, friendId, limit, beforeId)
      send(socket, { type: WS_MESSAGE_TYPE.messageHistory, friendId, messages })
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
  }
}

// Re-export helpers that are used inside the handler
import { isBanned } from '../auth'
import { normalizePreferences, joinQueue } from '../matchmaking'
