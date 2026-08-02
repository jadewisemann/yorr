import { expect, test } from '@playwright/test'

/** 알 수 없는 경로는 라우터의 notFoundComponent가 받는다. */

test('shows the not found screen with the requested path', async ({ page }) => {
  await page.goto('/no-such-page')

  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible()
  await expect(page.getByText('/no-such-page')).toBeVisible()
})

test('treats an incomplete room path as not found', async ({ page }) => {
  // /rooms/$roomId/lobby·game 만 라우트다 — 방 경로의 앞부분만으로는 들어갈 수 없다.
  await page.goto('/rooms/YORR64')

  await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible()
})

test('returns home from the not found screen', async ({ page }) => {
  await page.goto('/nope')
  await page.getByRole('button', { name: '홈으로' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
})
