import { useCallback, useEffect, useState } from 'preact/hooks'
import type { ActivityEntry, ActivityInstance } from '../../shared/types'
import {
  activitiesApi,
  onActivityEnded,
  onActivityLaunched,
} from '../api'
import type { LoadState } from './useSocialData'

export type ActivitySession = {
  instance: ActivityInstance
  activity: ActivityEntry
  /** Single-use launch code, handed to the iframe exactly once. */
  code: string
}

/**
 * Activity catalog + group instances + the open game session, for one group.
 *
 * The launcher list stays live: a game launched (or ended) by anyone in the
 * group refreshes it, and the open session closes itself when its game ends.
 * Closing the session view does NOT leave the game — the seat stays until an
 * explicit Leave, so a misclick never forfeits.
 */
export function useActivities(groupId: number | null) {
  const [catalog, setCatalog] = useState<ActivityEntry[]>([])
  const [instances, setInstances] = useState<ActivityInstance[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [session, setSession] = useState<ActivitySession | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (groupId == null) return
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const [catalogRes, instancesRes] = await Promise.all([
        activitiesApi.list(),
        activitiesApi.instances(groupId),
      ])
      setCatalog(catalogRes.activities)
      setInstances(instancesRes.instances)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [groupId])

  useEffect(() => {
    setSession(null)
    setInstances([])
    setState('idle')
    void load()
  }, [groupId, load])

  // Live launcher: anyone's launch/end re-reads this group's instances, and
  // the open session follows its own game off the cliff.
  useEffect(() => {
    if (groupId == null) return
    const offLaunched = onActivityLaunched((instance) => {
      if (instance.groupId === groupId) void load()
    })
    const offEnded = onActivityEnded((instanceId) => {
      setSession((cur) => (cur?.instance.id === instanceId ? null : cur))
      void load()
    })
    return () => {
      offLaunched()
      offEnded()
    }
  }, [groupId, load])

  const openSession = useCallback(
    async (instance: ActivityInstance) => {
      const entry = catalog.find((a) => a.id === instance.activityId)
      if (!entry) throw new Error('Unknown activity')
      const { code } = await activitiesApi.join(instance.id)
      setSession({ instance, activity: entry, code })
    },
    [catalog],
  )

  const launch = useCallback(
    async (activityId: number) => {
      if (groupId == null || busy) return
      setBusy(true)
      setFailed(false)
      try {
        const { instance } = await activitiesApi.launch(activityId, groupId)
        setInstances((prev) => [...prev, instance])
        await openSession(instance)
      } catch {
        setFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [groupId, busy, openSession],
  )

  const join = useCallback(
    async (instanceId: number) => {
      if (busy) return
      setBusy(true)
      setFailed(false)
      try {
        const instance = instances.find((i) => i.id === instanceId)
        if (!instance) throw new Error('Unknown game')
        await openSession(instance)
      } catch {
        setFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [busy, instances, openSession],
  )

  const leaveSession = useCallback(async () => {
    const cur = session
    setSession(null)
    if (!cur) return
    // Best-effort: the seat is server-side, so a failed call just leaves it
    // for the next open (or the game's own leave button retries it).
    await activitiesApi.leave(cur.instance.id).catch(() => {})
    void load()
  }, [session, load])

  const endSession = useCallback(async () => {
    const cur = session
    if (!cur) return
    setBusy(true)
    try {
      await activitiesApi.end(cur.instance.id)
    } finally {
      setBusy(false)
      setSession(null)
      void load()
    }
  }, [session, load])

  return {
    catalog,
    instances,
    state,
    reload: load,
    session,
    closeSession: () => setSession(null),
    launch,
    join,
    leaveSession,
    endSession,
    busy,
    failed,
  }
}
