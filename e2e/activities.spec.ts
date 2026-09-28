import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

async function registerAccount(
  request: APIRequestContext,
  tag: string,
): Promise<{ email: string; password: string; token: string; user: { id: number } }> {
  const email = `act_${tag}_${Date.now()}@example.com`
  const password = 'password12'
  const reg = await request.post('/api/v1/auth/register', {
    data: { email, password, birthDate: '1990-01-15' },
  })
  expect(reg.status()).toBe(201)
  const body = (await reg.json()) as { token: string; user: { id: number } }
  return { email, password, ...body }
}

/** Sign in through the real login form, like a user does. */
async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/social')
  // Fresh profiles land on the birthday gate before anything else.
  const gate = page.getByRole('dialog', { name: 'Complete your profile' })
  if (await gate.isVisible().catch(() => false)) {
    await gate.getByRole('combobox').nth(0).selectOption({ index: 1 })
    await gate.getByRole('combobox').nth(1).selectOption({ index: 5 })
    await gate.getByRole('combobox').nth(2).selectOption({ label: '1990' })
    await gate.getByRole('button', { name: 'Next' }).click()
  }
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address').fill(email)
  await dialog.getByLabel('Password').fill(password)
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New Group', exact: true })).toBeVisible({
    timeout: 15_000,
  })
}

test('activity game page renders the board without a host', async ({ page }) => {
  // The game shell is a public route; without a host it idles at "waiting".
  await page.goto('/activities/tictactoe')
  await expect(page.getByRole('heading', { name: 'Tic-Tac-Toe' })).toBeVisible()
  await expect(page.locator('.activity-cell')).toHaveCount(9)
  await expect(page.getByText('Waiting for players')).toBeVisible()
})

test('launch a game from a group and play', async ({ request, page }) => {
  const { email, password } = await registerAccount(request, 'solo')
  await loginViaUi(page, email, password)

  await page.getByRole('button', { name: 'New Group', exact: true }).click()
  await page.getByPlaceholder('Group name...').fill('E2E Gamers')
  await page.getByRole('button', { name: 'Create Group', exact: true }).click()

  // The new chat opens; its header carries the Activities launcher.
  await page.getByRole('button', { name: 'Activities', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Play' }).click()

  // The session embeds the game, which logs in with its launch code: the
  // "You play X" line only appears after the code→token→identity round trip.
  const frame = page.frameLocator('.activity-frame')
  await expect(frame.getByRole('heading', { name: 'Tic-Tac-Toe' })).toBeVisible()
  await expect(frame.getByText('You play X')).toBeVisible({ timeout: 15_000 })

  await frame.locator('.activity-cell').nth(4).click()
  await expect(frame.locator('.activity-cell').nth(4)).toHaveText('X')
})

test('two players share moves and the host ends the game', async ({ request, browser }) => {
  test.setTimeout(120_000)
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  try {
    const a = await registerAccount(request, 'dA')
    const b = await registerAccount(request, 'dB')

    // One group for both players, built over the API.
    const created = await request.post('/api/v1/groups', {
      headers: { authorization: `Bearer ${a.token}` },
      data: { name: 'E2E Duo', memberIds: [b.user.id] },
    })
    expect(created.status()).toBe(201)

    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()
    await loginViaUi(pageA, a.email, a.password)
    await loginViaUi(pageB, b.email, b.password)
    await pageA.getByRole('button', { name: /E2E Duo/ }).click()
    await pageB.getByRole('button', { name: /E2E Duo/ }).click()

    // A launches from the catalog; B joins the live game.
    await pageA.getByRole('button', { name: 'Activities', exact: true }).click()
    await pageA.getByRole('dialog').getByRole('button', { name: 'Play' }).click()
    const frameA = pageA.frameLocator('.activity-frame')
    await expect(frameA.getByText('You play X')).toBeVisible({ timeout: 15_000 })

    await pageB.getByRole('button', { name: 'Activities', exact: true }).click()
    await pageB.getByRole('dialog').getByRole('button', { name: 'Join' }).click()
    const frameB = pageB.frameLocator('.activity-frame')
    await expect(frameB.getByText('You play O')).toBeVisible({ timeout: 15_000 })

    // A move in one iframe lands on the other board through the relay.
    await frameA.locator('.activity-cell').nth(4).click()
    await expect(frameB.locator('.activity-cell').nth(4)).toHaveText('X', { timeout: 10_000 })

    await frameB.locator('.activity-cell').nth(0).click()
    await expect(frameA.locator('.activity-cell').nth(0)).toHaveText('O', { timeout: 10_000 })

    // The host ends it: both sessions close and the launcher empties.
    await pageA.getByRole('button', { name: 'End game', exact: true }).click()
    await expect(pageA.locator('.activity-session-modal')).toBeHidden({ timeout: 10_000 })
    await expect(pageB.locator('.activity-session-modal')).toBeHidden({ timeout: 10_000 })
    await expect(pageB.getByText('No active games')).toBeVisible({ timeout: 10_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
