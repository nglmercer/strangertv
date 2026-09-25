import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { spawnServer, waitHealthy, stopServer, testDbUrl } from './helpers/server'
import { type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { API_ROUTES } from '../shared/constants'

const PORT = 8804
const BASE = `http://127.0.0.1:${PORT}`

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

async function register(email: string) {
  const { status, json } = await req('POST', API_ROUTES.authRegister, undefined, {
    email,
    password: 'password12',
    birthDate: '1990-01-15',
  })
  expect(status).toBe(201)
  const user = json.user as { id: number; username?: string }
  return { user, token: json.token as string }
}

const link = (label: string) => ({
  label,
  desc: `${label} description`,
  domain: 'example.com',
  icon: 'M0 0h24v24H0z',
  color: 'green',
})

const section = () => ({ title: 'Links', icon: '', layout: 'rows', showCount: true })

describe('Profile links + usernames', () => {
  let child: ChildProcess
  let adaToken = ''
  let adaId = 0

  beforeAll(async () => {
    const databaseUrl = testDbUrl('profiles')
    execFileSync('cargo', ['run', '--quiet', '--bin', 'migrate-auth'], {
      cwd: 'rust',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TURSO_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
      },
      stdio: 'ignore',
    })
    child = spawnServer({
      PORT: String(PORT),
      ADMIN_KEY: 'profiles-admin',
      NODE_ENV: 'test',
      REGISTER_RATE_LIMIT: '1000',
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
      TURSO_DATABASE_URL: databaseUrl,
    })
    await waitHealthy(BASE)
  })

  afterAll(async () => {
    await stopServer(child)
  })

  it('assigns a username from the email at register', async () => {
    const { user, token } = await register('ada@example.com')
    adaToken = token
    adaId = user.id
    expect(user.username).toBe('ada')
  })

  it('suffixes colliding usernames', async () => {
    const first = await register('sam@x.io')
    expect(first.user.username).toBe('sam')
    const second = await register('sam@y.io')
    expect(second.user.username).toBe('sam1')
  })

  it('serves a default doc for a fresh account', async () => {
    const { status, json } = await req('GET', `/api/v1/profiles/ada`)
    expect(status).toBe(200)
    expect(json.username).toBe('ada')
    expect(json.userId).toBe(adaId)
    expect(json.links).toEqual([])
    expect(json.section).toEqual({ title: 'Links', icon: '', layout: 'rows', showCount: true })
  })

  it('404s unknown usernames', async () => {
    const { status } = await req('GET', `/api/v1/profiles/nonexistentuser`)
    expect(status).toBe(404)
  })

  it('rejects unauthenticated saves', async () => {
    const { status } = await req('PUT', `/api/v1/profiles/me`, undefined, {
      links: [],
      section: section(),
    })
    expect(status).toBe(401)
  })

  it('round-trips links + section', async () => {
    const { status, json } = await req('PUT', `/api/v1/profiles/me`, adaToken, {
      links: [link('Stream clips'), link('Photo gallery')],
      section: { title: 'Find me', icon: '', layout: 'grid', showCount: false },
    })
    expect(status).toBe(200)
    const links = json.links as Array<{ id: string; label: string }>
    expect(links.map((l) => l.label)).toEqual(['Stream clips', 'Photo gallery'])
    expect(typeof links[0]!.id).toBe('string')

    const get = await req('GET', `/api/v1/profiles/ada`)
    expect(get.status).toBe(200)
    expect((get.json.links as unknown[]).length).toBe(2)
    expect(get.json.section).toEqual({ title: 'Find me', icon: '', layout: 'grid', showCount: false })
  })

  it('replaces the whole list on save', async () => {
    await req('PUT', `/api/v1/profiles/me`, adaToken, { links: [link('Only')], section: section() })
    const get = await req('GET', `/api/v1/profiles/ada`)
    expect((get.json.links as Array<{ label: string }>).map((l) => l.label)).toEqual(['Only'])
  })

  it('validates the doc', async () => {
    const badLinks = await req('PUT', `/api/v1/profiles/me`, adaToken, {
      links: Array.from({ length: 9 }, (_, i) => link(`L${i}`)),
      section: section(),
    })
    expect(badLinks.status).toBe(400)

    const badColor = await req('PUT', `/api/v1/profiles/me`, adaToken, {
      links: [{ ...link('X'), color: 'red' }],
      section: section(),
    })
    expect(badColor.status).toBe(400)

    const badLayout = await req('PUT', `/api/v1/profiles/me`, adaToken, {
      links: [],
      section: { ...section(), layout: 'masonry' },
    })
    expect(badLayout.status).toBe(400)

    const tooLong = await req('PUT', `/api/v1/profiles/me`, adaToken, {
      links: [{ ...link('X'), label: 'x'.repeat(61) }],
      section: section(),
    })
    expect(tooLong.status).toBe(400)
  })

  it('renames and frees the old handle', async () => {
    const { status, json } = await req('PATCH', `/api/v1/users/me/username`, adaToken, {
      username: 'Ada_Lovelace',
    })
    expect(status).toBe(200)
    expect(json.username).toBe('ada_lovelace')

    expect((await req('GET', `/api/v1/profiles/ada`)).status).toBe(404)
    const moved = await req('GET', `/api/v1/profiles/ada_lovelace`)
    expect(moved.status).toBe(200)
    expect(moved.json.userId).toBe(adaId)
  })

  it('rejects taken and invalid usernames', async () => {
    const { token } = await register('grace@example.com')

    const taken = await req('PATCH', `/api/v1/users/me/username`, token, { username: 'ADA_lovelace' })
    expect(taken.status).toBe(409)

    for (const username of ['ab', 'has-dash', 'admin', '_lead', 'waytoolongusernamename']) {
      const res = await req('PATCH', `/api/v1/users/me/username`, token, { username })
      expect(res.status).toBe(400)
    }
  })

  it('reports the username from /auth/me', async () => {
    const { status, json } = await req('GET', API_ROUTES.authMe, adaToken)
    expect(status).toBe(200)
    expect((json.user as { username?: string }).username).toBe('ada_lovelace')
  })
})
