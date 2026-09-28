import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Messages } from '../i18n'
import { formatMessage } from '../i18n'
import { groupsApi, onActivityInvited, type ActivityInviteReceived } from '../api'
import { useActivities } from './useActivities'
import type { GroupMatchParticipant } from './useMatchSession'
import type { useMatchSocket } from './useMatchSocket'
import type { LoadState } from './useSocialData'

type MatchSocket = Pick<ReturnType<typeof useMatchSocket>, 'activityInvite'>

export type CallPeer = { userId: number; name: string }

export function peerDisplayName(email: string | undefined, userId: number): string {
  const local = email?.split('@')[0]?.trim()
  return local ? local : `User ${userId}`
}

/**
 * Authenticated call peers that can hold a party seat. Anonymous peers have
 * no user id, so they are excluded — the launcher tells the host to ask them
 * to sign in instead of offering a broken invite.
 */
export function resolveCallPeers({
  myUserId,
  peerUserId,
  peerEmail,
  groupParticipants,
}: {
  myUserId: number | null
  peerUserId: number | null
  peerEmail: string | null
  groupParticipants: GroupMatchParticipant[]
}): CallPeer[] {
  if (groupParticipants.length > 0) {
    const seen = new Set<number>()
    const peers: CallPeer[] = []
    for (const p of groupParticipants) {
      if (p.userId === myUserId || p.userId <= 0 || seen.has(p.userId)) continue
      seen.add(p.userId)
      peers.push({ userId: p.userId, name: peerDisplayName(p.email, p.userId) })
    }
    return peers
  }
  if (peerUserId == null || peerUserId <= 0 || peerUserId === myUserId) return []
  return [{ userId: peerUserId, name: peerDisplayName(peerEmail ?? undefined, peerUserId) }]
}

/**
 * In-call game parties: pick a game, a party group is provisioned for the
 * current call, and the other participant(s) get an invite prompt.
 *
 * The party is one group per call, created lazily when the launcher opens
 * (with every authenticated peer as a member up front), so launches reuse
 * the normal group instance flow — seats, launch codes, state relay, and
 * presence all work unchanged. After the host's session opens, an
 * `activity:invite` goes to every other socket in the room; accepts join
 * the instance and open the same session view.
 */
export function useCallParty({
  t,
  userId,
  roomId,
  matched,
  peerUserId,
  peerEmail,
  groupParticipants,
  socket,
}: {
  t: Messages
  userId: number | null
  roomId: string | null
  matched: boolean
  peerUserId: number | null
  peerEmail: string | null
  groupParticipants: GroupMatchParticipant[]
  socket: MatchSocket | null
}) {
  const peers = useMemo(
    () =>
      resolveCallPeers({
        myUserId: userId,
        peerUserId,
        peerEmail,
        groupParticipants,
      }),
    [userId, peerUserId, peerEmail, groupParticipants],
  )
  const [partyGroupId, setPartyGroupId] = useState<number | null>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [pendingInvite, setPendingInvite] = useState<ActivityInviteReceived | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionFailed, setProvisionFailed] = useState(false)
  const [joinInstanceId, setJoinInstanceId] = useState<number | null>(null)
  const sentInvites = useRef(new Set<number>())
  const roomRef = useRef(roomId)
  roomRef.current = roomId
  const activities = useActivities(partyGroupId)

  // A new call (or hangup) drops all party state. Leaving with a game open
  // gives the seat back, so the party ends for a 1:1 and shrinks for a group.
  const sessionRef = useRef(activities.session)
  sessionRef.current = activities.session
  const leaveRef = useRef(activities.leaveSession)
  leaveRef.current = activities.leaveSession
  useEffect(() => {
    if (sessionRef.current) void leaveRef.current()
    setPartyGroupId(null)
    setLauncherOpen(false)
    setPendingInvite(null)
    setProvisioning(false)
    setProvisionFailed(false)
    setJoinInstanceId(null)
    sentInvites.current = new Set()
    // Runs on room change only; session/leave flow through refs on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Invites for THIS room only; anything else (stale room, other tab's
  // group game) is ignored. The prompt hides while its game is already open.
  useEffect(() => {
    if (!roomId) return
    return onActivityInvited((invite) => {
      if (invite.roomId !== roomId) return
      if (sessionRef.current?.instance.id === invite.instance.id) return
      setPendingInvite((cur) => (cur?.instance.id === invite.instance.id ? cur : invite))
    })
  }, [roomId])

  const openLauncher = useCallback(async () => {
    if (!matched || !roomId || userId == null) return
    const room = roomId
    setLauncherOpen(true)
    setProvisionFailed(false)
    if (partyGroupId != null || peers.length === 0) return
    setProvisioning(true)
    try {
      const name = formatMessage(t.partyNameWith, {
        name: peers
          .map((p) => p.name)
          .slice(0, 3)
          .join(', '),
      })
      const { group } = await groupsApi.create(
        name,
        peers.map((p) => p.userId),
      )
      // The call may have ended while the group was created: never adopt a
      // party group for a room we already left.
      if (roomRef.current === room) setPartyGroupId(group.id)
    } catch {
      if (roomRef.current === room) setProvisionFailed(true)
    } finally {
      if (roomRef.current === room) setProvisioning(false)
    }
  }, [matched, roomId, userId, partyGroupId, peers, t])

  const closeLauncher = useCallback(() => setLauncherOpen(false), [])

  const launchPartyGame = useCallback(
    async (activityId: number) => {
      if (partyGroupId == null || !roomId) return
      await activities.launch(activityId)
    },
    [partyGroupId, roomId, activities],
  )

  // The launcher opens a session for games anyone launched; only the
  // launcher's own client invites the room, and only once per game.
  useEffect(() => {
    const session = activities.session
    if (!session || !roomId || !socket || session.instance.createdBy !== userId) return
    if (sentInvites.current.has(session.instance.id)) return
    sentInvites.current.add(session.instance.id)
    socket.activityInvite(roomId, session.instance.id)
  }, [activities.session, roomId, socket, userId])

  const acceptInvite = useCallback(() => {
    const invite = pendingInvite
    if (!invite || userId == null) return
    setPendingInvite(null)
    setPartyGroupId(invite.instance.groupId)
    setJoinInstanceId(invite.instance.id)
    // The launcher shows under the join: a failed join lands on its error
    // instead of stranding the user with no feedback.
    setLauncherOpen(true)
  }, [pendingInvite, userId])

  const declineInvite = useCallback(() => setPendingInvite(null), [])

  // Accepts join as soon as the party group (and its instance list) loads.
  useEffect(() => {
    if (joinInstanceId == null) return
    if (!activities.instances.some((i) => i.id === joinInstanceId)) return
    setJoinInstanceId(null)
    void activities.join(joinInstanceId)
  }, [joinInstanceId, activities])

  const launcherState: LoadState =
    provisioning || (partyGroupId == null && !provisionFailed)
      ? 'loading'
      : provisionFailed
        ? 'error'
        : activities.state

  const retryLauncher = useCallback(() => {
    if (provisionFailed) void openLauncher()
    else void activities.reload()
  }, [provisionFailed, openLauncher, activities])

  return {
    peers,
    launcherOpen,
    openLauncher,
    closeLauncher,
    launcherState,
    launcherFailed: activities.failed,
    retryLauncher,
    catalog: activities.catalog,
    instances: activities.instances,
    busy: activities.busy,
    launch: launchPartyGame,
    join: activities.join,
    session: activities.session,
    closeSession: activities.closeSession,
    leaveSession: activities.leaveSession,
    endSession: activities.endSession,
    pendingInvite:
      pendingInvite && activities.session?.instance.id !== pendingInvite.instance.id
        ? pendingInvite
        : null,
    acceptInvite,
    declineInvite,
  }
}
