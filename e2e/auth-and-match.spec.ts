import { test, expect, type Page } from '@playwright/test'

async function completeAgeGate(page: Page) {
  await page.goto('/')
  // Profile age gate if present
  const next = page.getByRole('button', { name: /Next|Siguiente|Próximo/i })
  if (await next.isVisible().catch(() => false)) {
    await page.locator('.selects select').nth(0).selectOption({ index: 1 })
    await page.locator('.selects select').nth(1).selectOption({ index: 5 })
    await page.locator('.selects select').nth(2).selectOption({ label: '1990' })
    await next.click()
  }
}

test('health API is ok', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.version).toBeTruthy()
})

test('register and login via API', async ({ request }) => {
  const email = `e2e_${Date.now()}@example.com`
  const password = 'password12'
  const reg = await request.post('/api/auth/register', {
    data: { email, password, birthDate: '1990-01-15' },
  })
  expect(reg.status()).toBe(201)
  const regBody = await reg.json()
  expect(regBody.token).toBeTruthy()
  expect(regBody.user.email).toBe(email)

  const me = await request.get('/api/auth/me', {
    headers: { authorization: `Bearer ${regBody.token}` },
  })
  expect(me.ok()).toBeTruthy()

  const login = await request.post('/api/auth/login', {
    data: { email, password },
  })
  expect(login.ok()).toBeTruthy()
})

test('two clients match over websocket', async () => {
  const prefs = {
    country: 'any',
    language: 'any',
    gender: 'any',
    lookingFor: 'any',
    interests: [],
  }
  const port = process.env.E2E_PORT ?? '8797'
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  const open = () =>
    new Promise<{ ws: WebSocket; role?: string; roomId?: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => reject(new Error('timeout')), 10_000)
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'queue:join', preferences: prefs }))
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as { type: string; role?: string; roomId?: string }
        if (msg.type === 'room:matched') {
          clearTimeout(timer)
          resolve({ ws, role: msg.role, roomId: msg.roomId })
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('ws error'))
      }
    })

  const [a, b] = await Promise.all([open(), open()])
  expect(a.roomId).toBeTruthy()
  expect(a.roomId).toBe(b.roomId)
  expect(new Set([a.role, b.role])).toEqual(new Set(['offerer', 'answerer']))
  a.ws.close()
  b.ws.close()
})

test('landing shows brand and start control', async ({ page }) => {
  await completeAgeGate(page)
  await expect(page.locator('.brand')).toContainText(/stranger/i)
  await expect(page.locator('.deck-card.start')).toBeVisible()
})

test('admin page unlocks with key', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: /Moderation|Moderación|Moderação/i })).toBeVisible()
  await page.locator('input[type="password"]').fill('test-admin-key')
  await page.getByRole('button', { name: /Unlock|Desbloquear/i }).click()
  await expect(page.getByText(/Online|Users|Users|En línea|Usuarios|Aguardando|Report/i).first()).toBeVisible({
    timeout: 10_000,
  })
})

test('admin overview requires key', async ({ request }) => {
  const denied = await request.get('/api/admin/overview')
  expect(denied.status()).toBe(403)
  const ok = await request.get('/api/admin/overview', {
    headers: { 'x-admin-key': 'test-admin-key' },
  })
  expect(ok.ok()).toBeTruthy()
  const body = await ok.json()
  expect(body.metrics).toBeTruthy()
})

test('ready and prometheus metrics', async ({ request }) => {
  const ready = await request.get('/api/health/ready')
  expect(ready.ok()).toBeTruthy()
  const live = await request.get('/api/health/live')
  expect(live.ok()).toBeTruthy()
  const prom = await request.get('/api/metrics/prometheus', {
    headers: { 'x-admin-key': 'test-admin-key' },
  })
  expect(prom.ok()).toBeTruthy()
  const text = await prom.text()
  expect(text).toContain('stranger_uptime_seconds')
})

test('register returns verify token in non-prod and verify works', async ({ request }) => {
  const email = `verify_${Date.now()}@example.com`
  const reg = await request.post('/api/auth/register', {
    data: { email, password: 'password12', birthDate: '1990-01-15' },
  })
  expect(reg.status()).toBe(201)
  const body = await reg.json()
  expect(body.devVerifyToken).toBeTruthy()
  const verified = await request.post('/api/auth/verify-email', {
    data: { token: body.devVerifyToken },
  })
  expect(verified.ok()).toBeTruthy()
})

test('admin reports csv', async ({ request }) => {
  const res = await request.get('/api/admin/reports.csv', {
    headers: { 'x-admin-key': 'test-admin-key' },
  })
  expect(res.ok()).toBeTruthy()
  const text = await res.text()
  expect(text.startsWith('id,')).toBeTruthy()
})

test('robots and security.txt are served', async ({ request }) => {
  const robots = await request.get('/robots.txt')
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Disallow: /admin')
  const sec = await request.get('/.well-known/security.txt')
  expect(sec.ok()).toBeTruthy()
  expect(await sec.text()).toContain('Contact:')
})

test('openapi docs and session refresh', async ({ request }) => {
  const docs = await request.get('/api/docs')
  expect(docs.ok()).toBeTruthy()
  const body = await docs.json()
  expect(body.openapi).toMatch(/^3\./)
  expect(body.paths['/api/auth/refresh']).toBeTruthy()

  const email = `ref_${Date.now()}@example.com`
  const reg = await request.post('/api/auth/register', {
    data: { email, password: 'password12', birthDate: '1990-01-15' },
  })
  const { token } = await reg.json()
  const refreshed = await request.post('/api/auth/refresh', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(refreshed.ok()).toBeTruthy()
  const next = await refreshed.json()
  expect(next.token).toBeTruthy()
  expect(next.token).not.toBe(token)
})
