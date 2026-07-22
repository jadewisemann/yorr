import { expect, test } from '@playwright/test'

test('shows the mobile entry screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'YORR' })).toBeVisible()
  await expect(page.getByRole('button', { name: '게임 시작' })).toBeVisible()
})
