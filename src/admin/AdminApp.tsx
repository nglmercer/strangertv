import { useCallback, useEffect, useState } from 'preact/hooks'
import { detectLocale, t as translate } from '../i18n'
import {
  ADMIN_TAB,
  AdminTab,
  API_ROUTES,
  BAN_REASON_DEFAULT,
  HTTP_HEADERS,
  MIME_TYPE,
  REPORT_STATUS_FILTER,
  ReportStatusFilter,
  STORAGE_KEYS,
  TIMING_MS,
} from '../../shared/constants'
import { get, remove, set } from '../../utils/storage'

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

const keyStorage = STORAGE_KEYS.adminKey

async function adminFetch<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set(HTTP_HEADERS.xAdminKey, key)
  if (init?.body && !headers.has(HTTP_HEADERS.contentType)) headers.set(HTTP_HEADERS.contentType, MIME_TYPE.json)
  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export function AdminApp() {
  const tr = translate(detectLocale()).admin
  const [key, setKey] = useState(() => get(keyStorage) ?? '')
  const [inputKey, setInputKey] = useState(key)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [bans, setBans] = useState<Ban[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [banForm, setBanForm] = useState({ userId: '', ip: '', reason: BAN_REASON_DEFAULT, hours: '24' })
  const [tab, setTab] = useState<AdminTab>(ADMIN_TAB.overview)
  const [reportFilter, setReportFilter] = useState<ReportStatusFilter>(REPORT_STATUS_FILTER.open)

  const unlock = () => {
    set(keyStorage, inputKey)
    setKey(inputKey)
    setError('')
  }

  const load = useCallback(async () => {
    if (!key) return
    setError('')
    try {
      const reportsPath =
        reportFilter === REPORT_STATUS_FILTER.all
          ? API_ROUTES.adminReports
          : `${API_ROUTES.adminReports}?status=${reportFilter}`
      const [ov, rep, ban] = await Promise.all([
        adminFetch<Overview>(API_ROUTES.adminOverview, key),
        adminFetch<{ reports: Report[] }>(reportsPath, key),
        adminFetch<{ bans: Ban[] }>(API_ROUTES.adminBans, key),
      ])
      setOverview(ov)
      setReports(rep.reports as Report[])
      setBans(ban.bans as Ban[])
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.failedLoad)
      setOverview(null)
    }
  }, [key, reportFilter, tr.failedLoad])

  useEffect(() => {
    void load()
    if (!key) return
    const iv = window.setInterval(() => void load(), TIMING_MS.healthPoll)
    return () => clearInterval(iv)
  }, [key, load])

  const searchUsers = async () => {
    try {
      const data = await adminFetch<{ users: UserRow[] }>(
        `${API_ROUTES.adminUsers}?q=${encodeURIComponent(userQuery)}`,
        key,
      )
      setUsers(data.users as UserRow[])
      setTab('users')
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.searchFailed)
    }
  }

  const submitBan = async (event: Event) => {
    event.preventDefault()
    try {
      await adminFetch(API_ROUTES.adminBan, key, {
        method: 'POST',
        body: JSON.stringify({
          userId: banForm.userId ? Number(banForm.userId) : undefined,
          ip: banForm.ip || undefined,
          reason: banForm.reason,
          hours: banForm.hours ? Number(banForm.hours) : undefined,
        }),
      })
      setBanForm({ userId: '', ip: '', reason: BAN_REASON_DEFAULT, hours: '24' })
      await load()
      setTab('bans')
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.banFailed)
    }
  }

  const removeBan = async (id: number) => {
    try {
      await adminFetch(API_ROUTES.adminBanById(id), key, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tr.unbanFailed)
    }
  }

  const tabLabel = {
    overview: tr.tabOverview,
    reports: tr.tabReports,
    bans: tr.tabBans,
    users: tr.tabUsers,
  } as const

  if (!key) {
    return (
      <main class="admin">
        <section class="admin-card">
          <h1>{tr.consoleTitle}</h1>
          <p class="muted">{tr.consoleHint}</p>
          <label>
            {tr.adminKey}
            <input
              type="password"
              value={inputKey}
              onInput={(e) => setInputKey(e.currentTarget.value)}
              placeholder={tr.adminKey}
            />
          </label>
          <button type="button" class="admin-btn" onClick={unlock} disabled={!inputKey.trim()}>
            {tr.unlock}
          </button>
          <p class="muted">
            <a href="/">← {tr.backToApp}</a>
          </p>
        </section>
      </main>
    )
  }

  return (
    <main class="admin">
      <header class="admin-top">
        <div>
          <h1>{tr.title}</h1>
          <p class="muted">{tr.subtitle}</p>
        </div>
        <div class="admin-actions">
          <button type="button" class="admin-btn ghost" onClick={() => void load()}>
            {tr.refresh}
          </button>
          <a
            class="admin-btn ghost"
            href={API_ROUTES.adminReportsCsv}
            onClick={(e) => {
              e.preventDefault()
              void fetch(API_ROUTES.adminReportsCsv, { headers: { [HTTP_HEADERS.xAdminKey]: key } })
                .then((r) => r.blob())
                .then((blob) => {
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'reports.csv'
                  a.click()
                  URL.revokeObjectURL(url)
                })
            }}
          >
            {tr.exportCsv}
          </a>
          <button
            type="button"
            class="admin-btn ghost"
            onClick={() => {
              remove(keyStorage)
              setKey('')
            }}
          >
            {tr.lock}
          </button>
          <a class="admin-btn ghost" href="/">
            {tr.app}
          </a>
        </div>
      </header>

      {error && <p class="admin-error">{error}</p>}

      <nav class="admin-tabs">
        {Object.values(ADMIN_TAB).map((tabKey) => (
          <button type="button" class={tab === tabKey ? 'on' : ''} onClick={() => setTab(tabKey)}>
            {tabLabel[tabKey]}
          </button>
        ))}
      </nav>

      {tab === ADMIN_TAB.overview && overview && (
        <section class="admin-grid">
          <article class="stat">
            <strong>{overview.queue.online}</strong>
            <span>{tr.online}</span>
          </article>
          <article class="stat">
            <strong>{overview.queue.waiting}</strong>
            <span>{tr.waiting}</span>
          </article>
          <article class="stat">
            <strong>{overview.users}</strong>
            <span>{tr.users}</span>
          </article>
          <article class="stat">
            <strong>{overview.openReports ?? overview.reports}</strong>
            <span>{tr.openReports}</span>
          </article>
          <article class="stat">
            <strong>{overview.reports}</strong>
            <span>{tr.reportsTotal}</span>
          </article>
          <article class="stat">
            <strong>{overview.activeBans}</strong>
            <span>{tr.activeBans}</span>
          </article>
          <article class="stat">
            <strong>
              {overview.ratings?.average != null ? overview.ratings.average.toFixed(2) : '—'}
            </strong>
            <span>
              {tr.avgRating} ({overview.ratings?.count ?? 0})
            </span>
          </article>
          <article class={`stat ${overview.underageOpen ? 'stat-alert' : ''}`}>
            <strong>{overview.underageOpen ?? 0}</strong>
            <span>{tr.openUnderage}</span>
          </article>
          <article class="stat">
            <strong>{overview.metrics.memoryMb} MB</strong>
            <span>{tr.memory}</span>
          </article>
          {overview.version && (
            <article class="stat">
              <strong>v{overview.version}</strong>
              <span>{tr.server}</span>
            </article>
          )}
          <article class="stat wide">
            <strong>
              p50 {overview.metrics.matchLatencyMs.p50}ms · p95 {overview.metrics.matchLatencyMs.p95}ms
            </strong>
            <span>
              {tr.matchWait} ({overview.metrics.matchLatencyMs.samples} {tr.samples})
            </span>
          </article>
          <article class="stat wide">
            <pre class="counters">{JSON.stringify(overview.metrics.counters, null, 2)}</pre>
          </article>
        </section>
      )}

      {tab === ADMIN_TAB.reports && (
        <section class="admin-card table-wrap">
          <div class="reports-head">
            <h2>{tr.reports}</h2>
            <div class="filter-row">
              {Object.values(REPORT_STATUS_FILTER).map((f) => (
                <button
                  type="button"
                  key={f}
                  class={reportFilter === f ? 'admin-btn sm' : 'admin-btn ghost sm'}
                  onClick={() => setReportFilter(f)}
                >
                  {f === REPORT_STATUS_FILTER.open
                    ? tr.filterOpen
                    : f === REPORT_STATUS_FILTER.resolved
                      ? tr.filterResolved
                      : tr.filterAll}
                </button>
              ))}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>{tr.colId}</th>
                <th>{tr.colStatus}</th>
                <th>{tr.colReason}</th>
                <th>{tr.colRoom}</th>
                <th>{tr.colReporter}</th>
                <th>{tr.colDetail}</th>
                <th>{tr.colWhen}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    {(r.status ?? REPORT_STATUS_FILTER.open) === REPORT_STATUS_FILTER.resolved ? tr.filterResolved : tr.filterOpen}
                  </td>
                  <td>{r.reason}</td>
                  <td class="mono">{r.room_id ?? '—'}</td>
                  <td class="mono">{r.reporter_id ?? r.reporter_session ?? '—'}</td>
                  <td>{r.detail ?? ''}</td>
                  <td>{r.created_at}</td>
                  <td class="row-actions">
                    {(r.status ?? REPORT_STATUS_FILTER.open) !== REPORT_STATUS_FILTER.resolved && (
                      <button
                        type="button"
                        class="admin-btn sm"
                        onClick={() =>
                          void adminFetch(API_ROUTES.adminReportById(r.id), key, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: REPORT_STATUS_FILTER.resolved }),
                          }).then(() => load())
                        }
                      >
                        {tr.resolve}
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
                        {tr.banReporter}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reports.length && <p class="muted">{tr.noReports}</p>}
        </section>
      )}

      {tab === ADMIN_TAB.bans && (
        <section class="admin-card">
          <h2>{tr.bans}</h2>
          <form class="ban-form" onSubmit={submitBan}>
            <label>
              {tr.userId}
              <input
                value={banForm.userId}
                onInput={(e) => setBanForm({ ...banForm, userId: e.currentTarget.value })}
                placeholder={tr.optional}
              />
            </label>
            <label>
              {tr.ip}
              <input
                value={banForm.ip}
                onInput={(e) => setBanForm({ ...banForm, ip: e.currentTarget.value })}
                placeholder={tr.optional}
              />
            </label>
            <label>
              {tr.reason}
              <input
                value={banForm.reason}
                onInput={(e) => setBanForm({ ...banForm, reason: e.currentTarget.value })}
              />
            </label>
            <label>
              {tr.hours}
              <input
                value={banForm.hours}
                onInput={(e) => setBanForm({ ...banForm, hours: e.currentTarget.value })}
                placeholder={tr.emptyPermanent}
              />
            </label>
            <button type="submit" class="admin-btn danger">
              {tr.createBan}
            </button>
          </form>
          <table>
            <thead>
              <tr>
                <th>{tr.colId}</th>
                <th>{tr.colUser}</th>
                <th>{tr.ip}</th>
                <th>{tr.reason}</th>
                <th>{tr.colExpires}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bans.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{b.user_id ?? '—'}</td>
                  <td class="mono">{b.ip ?? '—'}</td>
                  <td>{b.reason}</td>
                  <td>{b.expires_at ?? tr.permanent}</td>
                  <td>
                    <button type="button" class="admin-btn sm" onClick={() => void removeBan(b.id)}>
                      {tr.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === ADMIN_TAB.users && (
        <section class="admin-card">
          <h2>{tr.users}</h2>
          <div class="row">
            <input
              value={userQuery}
              onInput={(e) => setUserQuery(e.currentTarget.value)}
              placeholder={tr.searchEmail}
            />
            <button type="button" class="admin-btn" onClick={() => void searchUsers()}>
              {tr.search}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>{tr.colId}</th>
                <th>{tr.colEmail}</th>
                <th>{tr.colCountry}</th>
                <th>{tr.colCreated}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
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
                      {tr.ban}
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
