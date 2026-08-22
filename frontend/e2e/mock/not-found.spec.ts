import { expect, test } from '@playwright/test'

test('shows the not found screen with the requested path', async ({ page }) => {
  await page.goto('/no-such-page')

  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible()
  await expect(page.getByText('/no-such-page')).toBeVisible()
})

test('treats an incomplete room path as not found', async ({ page }) => {
  await page.goto('/rooms/YORR64')

  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible()
})

test('returns home from the not found screen', async ({ page }) => {
  await page.goto('/nope')
  await page.getByRole('button', { name: '홈으로' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
})
