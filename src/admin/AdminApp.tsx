import { useCallback, useEffect, useState } from 'preact/hooks'

type Overview = {
  queue: { waiting: number; online: number }
  users: number
  reports: number
  openReports?: number
  underageOpen?: number
  activeBans: number
  ratings?: { count: number; average: number | null }
  version?: string
  metrics: {
    counters: Record<string, number>
    matchLatencyMs: { p50: number; p95: number; samples: number }
    uptimeSec: number
    memoryMb: number
  }
}

type Report = {
  id: number
  reporter_id: number | null
  reporter_session: string | null
  room_id: string | null
  reason: string
  detail: string | null
  status?: string
  created_at: string
}

type Ban = {
  id: number
  user_id: number | null
  ip: string | null
  reason: string | null
  expires_at: string | null
  created_at: string
}

type UserRow = {
  id: number
  email: string
  birth_date: string | null
  country: string | null
  created_at: string
}

const keyStorage = 'stranger-admin-key'

async function adminFetch<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('x-admin-key', key)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export function AdminApp() {
  const [key, setKey] = useState(() => localStorage.getItem(keyStorage) ?? '')
  const [inputKey, setInputKey] = useState(key)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [bans, setBans] = useState<Ban[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [banForm, setBanForm] = useState({ userId: '', ip: '', reason: 'moderation', hours: '24' })
  const [tab, setTab] = useState<'overview' | 'reports' | 'bans' | 'users'>('overview')
  const [reportFilter, setReportFilter] = useState<'all' | 'open' | 'resolved'>('open')

  const unlock = () => {
    localStorage.setItem(keyStorage, inputKey)
    setKey(inputKey)
    setError('')
  }

  const load = useCallback(async () => {
    if (!key) return
    setError('')
    try {
      const reportsPath =
        reportFilter === 'all' ? '/api/admin/reports' : `/api/admin/reports?status=${reportFilter}`
      const [ov, rep, ban] = await Promise.all([
        adminFetch<Overview>('/api/admin/overview', key),
        adminFetch<{ reports: Report[] }>(reportsPath, key),
        adminFetch<{ bans: Ban[] }>('/api/admin/bans', key),
      ])
      setOverview(ov)
      setReports(rep.reports as Report[])
      setBans(ban.bans as Ban[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setOverview(null)
    }
  }, [key, reportFilter])

  useEffect(() => {
    void load()
    if (!key) return
    const iv = window.setInterval(() => void load(), 15_000)
    return () => clearInterval(iv)
  }, [key, load])

  const searchUsers = async () => {
    try {
      const data = await adminFetch<{ users: UserRow[] }>(
        `/api/admin/users?q=${encodeURIComponent(userQuery)}`,
        key,
      )
      setUsers(data.users as UserRow[])
      setTab('users')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    }
  }

  const submitBan = async (event: Event) => {
    event.preventDefault()
    try {
      await adminFetch('/api/admin/ban', key, {
        method: 'POST',
        body: JSON.stringify({
          userId: banForm.userId ? Number(banForm.userId) : undefined,
          ip: banForm.ip || undefined,
          reason: banForm.reason,
          hours: banForm.hours ? Number(banForm.hours) : undefined,
        }),
      })
      setBanForm({ userId: '', ip: '', reason: 'moderation', hours: '24' })
      await load()
      setTab('bans')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ban failed')
    }
  }

  const removeBan = async (id: number) => {
    try {
      await adminFetch(`/api/admin/ban/${id}`, key, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unban failed')
    }
  }

  if (!key) {
    return (
      <main class="admin">
        <section class="admin-card">
          <h1>Moderation console</h1>
          <p class="muted">Enter the server <code>ADMIN_KEY</code>. Stored only in this browser.</p>
          <label>
            Admin key
            <input
              type="password"
              value={inputKey}
              onInput={(e) => setInputKey(e.currentTarget.value)}
              placeholder="ADMIN_KEY"
            />
          </label>
          <button type="button" class="admin-btn" onClick={unlock} disabled={!inputKey.trim()}>
            Unlock
          </button>
          <p class="muted">
            <a href="/">← Back to app</a>
          </p>
        </section>
      </main>
    )
  }

  return (
    <main class="admin">
      <header class="admin-top">
        <div>
          <h1>Moderation</h1>
          <p class="muted">stranger ops · auto-refresh 15s</p>
        </div>
        <div class="admin-actions">
          <button type="button" class="admin-btn ghost" onClick={() => void load()}>
            Refresh
          </button>
          <a class="admin-btn ghost" href={`/api/admin/reports.csv`} onClick={(e) => {
            e.preventDefault()
            void fetch('/api/admin/reports.csv', { headers: { 'x-admin-key': key } })
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'reports.csv'
                a.click()
                URL.revokeObjectURL(url)
              })
          }}>
            Export CSV
          </a>
          <button
            type="button"
            class="admin-btn ghost"
            onClick={() => {
              localStorage.removeItem(keyStorage)
              setKey('')
            }}
          >
            Lock
          </button>
          <a class="admin-btn ghost" href="/">
            App
          </a>
        </div>
      </header>

      {error && <p class="admin-error">{error}</p>}

      <nav class="admin-tabs">
        {(['overview', 'reports', 'bans', 'users'] as const).map((t) => (
          <button type="button" class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'overview' && overview && (
        <section class="admin-grid">
          <article class="stat">
            <strong>{overview.queue.online}</strong>
            <span>Online</span>
          </article>
          <article class="stat">
            <strong>{overview.queue.waiting}</strong>
            <span>Waiting</span>
          </article>
          <article class="stat">
            <strong>{overview.users}</strong>
            <span>Users</span>
          </article>
          <article class="stat">
            <strong>{overview.openReports ?? overview.reports}</strong>
            <span>Open reports</span>
          </article>
          <article class="stat">
            <strong>{overview.reports}</strong>
            <span>Reports total</span>
          </article>
          <article class="stat">
            <strong>{overview.activeBans}</strong>
            <span>Active bans</span>
          </article>
          <article class="stat">
            <strong>
              {overview.ratings?.average != null ? overview.ratings.average.toFixed(2) : '—'}
            </strong>
            <span>Avg rating ({overview.ratings?.count ?? 0})</span>
          </article>
          <article class={`stat ${overview.underageOpen ? 'stat-alert' : ''}`}>
            <strong>{overview.underageOpen ?? 0}</strong>
            <span>Open underage</span>
          </article>
          <article class="stat">
            <strong>{overview.metrics.memoryMb} MB</strong>
            <span>RSS</span>
          </article>
          {overview.version && (
            <article class="stat">
              <strong>v{overview.version}</strong>
              <span>Server</span>
            </article>
          )}
          <article class="stat wide">
            <strong>
              p50 {overview.metrics.matchLatencyMs.p50}ms · p95 {overview.metrics.matchLatencyMs.p95}ms
            </strong>
            <span>Match wait ({overview.metrics.matchLatencyMs.samples} samples)</span>
          </article>
          <article class="stat wide">
            <pre class="counters">{JSON.stringify(overview.metrics.counters, null, 2)}</pre>
          </article>
        </section>
      )}

      {tab === 'reports' && (
        <section class="admin-card table-wrap">
          <div class="reports-head">
            <h2>Reports</h2>
            <div class="filter-row">
              {(['open', 'resolved', 'all'] as const).map((f) => (
                <button
                  type="button"
                  key={f}
                  class={reportFilter === f ? 'admin-btn sm' : 'admin-btn ghost sm'}
                  onClick={() => setReportFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Room</th>
                <th>Reporter</th>
                <th>Detail</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr>
                  <td>{r.id}</td>
                  <td>{r.status ?? 'open'}</td>
                  <td>{r.reason}</td>
                  <td class="mono">{r.room_id ?? '—'}</td>
                  <td class="mono">{r.reporter_id ?? r.reporter_session ?? '—'}</td>
                  <td>{r.detail ?? ''}</td>
                  <td>{r.created_at}</td>
                  <td class="row-actions">
                    {(r.status ?? 'open') !== 'resolved' && (
                      <button
                        type="button"
                        class="admin-btn sm"
                        onClick={() =>
                          void adminFetch(`/api/admin/reports/${r.id}`, key, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'resolved' }),
                          }).then(() => load())
                        }
                      >
                        Resolve
                      </button>
                    )}
                    {r.reporter_id != null && (
                      <button
                        type="button"
                        class="admin-btn danger sm"
                        onClick={() => {
                          setBanForm((f) => ({ ...f, userId: String(r.reporter_id) }))
                          setTab('bans')
                        }}
                      >
                        Ban reporter
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reports.length && <p class="muted">No reports yet.</p>}
        </section>
      )}

      {tab === 'bans' && (
        <section class="admin-card">
          <h2>Bans</h2>
          <form class="ban-form" onSubmit={submitBan}>
            <label>
              User ID
              <input
                value={banForm.userId}
                onInput={(e) => setBanForm({ ...banForm, userId: e.currentTarget.value })}
                placeholder="optional"
              />
            </label>
            <label>
              IP
              <input
                value={banForm.ip}
                onInput={(e) => setBanForm({ ...banForm, ip: e.currentTarget.value })}
                placeholder="optional"
              />
            </label>
            <label>
              Reason
              <input
                value={banForm.reason}
                onInput={(e) => setBanForm({ ...banForm, reason: e.currentTarget.value })}
              />
            </label>
            <label>
              Hours
              <input
                value={banForm.hours}
                onInput={(e) => setBanForm({ ...banForm, hours: e.currentTarget.value })}
                placeholder="empty = permanent"
              />
            </label>
            <button type="submit" class="admin-btn danger">
              Create ban
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>IP</th>
                <th>Reason</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bans.map((b) => (
                <tr>
                  <td>{b.id}</td>
                  <td>{b.user_id ?? '—'}</td>
                  <td class="mono">{b.ip ?? '—'}</td>
                  <td>{b.reason}</td>
                  <td>{b.expires_at ?? 'permanent'}</td>
                  <td>
                    <button type="button" class="admin-btn sm" onClick={() => void removeBan(b.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'users' && (
        <section class="admin-card">
          <h2>Users</h2>
          <div class="row">
            <input
              value={userQuery}
              onInput={(e) => setUserQuery(e.currentTarget.value)}
              placeholder="Search email"
            />
            <button type="button" class="admin-btn" onClick={() => void searchUsers()}>
              Search
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Email</th>
                <th>Country</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr>
                  <td>{u.id}</td>
                  <td>{u.email}</td>
                  <td>{u.country}</td>
                  <td>{u.created_at}</td>
                  <td>
                    <button
                      type="button"
                      class="admin-btn danger sm"
                      onClick={() => {
                        setBanForm((f) => ({ ...f, userId: String(u.id) }))
                        setTab('bans')
                      }}
                    >
                      Ban
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
