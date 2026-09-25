import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { spawnServer, stopServer, testDbUrl, waitHealthy } from './helpers/server'
import { API_ROUTES } from '../shared/constants'

/**
 * Group member enumeration is membership-gated: only a member of the group
 * may list its roster. Authenticated non-members get a refusal that carries
 * no member data, and unauthenticated callers get a 401.
 */

const PORT = 8803
const BASE = `http://127.0.0.1:${PORT}`
const SECRET = 'test-secret-that-is-at-least-32-bytes-long'

type Registration = { token: string; user: { id: number; email: string } }

describe('group members authorization', () => {
  let child: ChildProcess
  let owner!: Registration
  let member!: Registration
  let outsider!: Registration
  let groupId!: number

  const register = async (tag: string): Promise<Registration> => {
    const res = await fetch(`${BASE}${API_ROUTES.authRegister}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `gmem_${tag}_${Date.now()}@example.com`,
        password: 'password12',
        birthDate: '1990-02-02',
      }),
    })
    expect(res.status).toBe(201)
    return (await res.json()) as Registration
  }

  const membersUrl = () => `${BASE}${API_ROUTES.groupMembers(groupId)}`

  beforeAll(async () => {
    const databaseUrl = testDbUrl('group-members-authz')
    execFileSync('cargo', ['run', '--quiet', '--bin', 'migrate-auth'], {
      cwd: 'rust',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: SECRET,
      },
      stdio: 'ignore',
    })
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'group-members-admin',
      NODE_ENV: 'test',
      REGISTER_RATE_LIMIT: '1000',
      BETTER_AUTH_SECRET: SECRET,
      TURSO_DATABASE_URL: databaseUrl,
    })
    await waitHealthy(BASE)

    owner = await register('owner')
    member = await register('member')
    outsider = await register('outsider')

    const created = await fetch(`${BASE}${API_ROUTES.groups}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ name: 'Secret club', memberIds: [member.user.id] }),
    })
    expect(created.status).toBe(201)
    groupId = ((await created.json()) as { group: { id: number } }).group.id
    expect(groupId).toBeTruthy()
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('members can list the roster', async () => {
    const res = await fetch(membersUrl(), {
      headers: { authorization: `Bearer ${member.token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { members: Array<{ userId: number }> }
    const ids = body.members.map((m) => m.userId).sort()
    expect(ids).toEqual([owner.user.id, member.user.id].sort())
  })

  it('non-members cannot enumerate member data', async () => {
    const res = await fetch(membersUrl(), {
      headers: { authorization: `Bearer ${outsider.token}` },
    })
    expect(res.status).toBe(400)
    const raw = await res.text()
    expect(raw).not.toContain(owner.user.email)
    expect(raw).not.toContain(member.user.email)
    expect(raw).not.toContain(String(member.user.id))
    expect(JSON.parse(raw)).not.toHaveProperty('members')
  })

  it('unauthenticated callers get a 401 with no member data', async () => {
    const res = await fetch(membersUrl())
    expect(res.status).toBe(401)
    const raw = await res.text()
    expect(raw).not.toContain(owner.user.email)
    expect(raw).not.toContain(member.user.email)
  })
})
