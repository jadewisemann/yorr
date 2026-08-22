import { expect, test } from '@playwright/test'

test('shows the mobile entry screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('YORR', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  await expect(page.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()

  await expect(page.getByRole('button', { name: /코드로 참가$/ }).first()).toBeVisible()
})

test('opens a valid invite link at nickname entry', async ({ page }) => {
  await page.goto('/join?code=yorr64')

  await expect(page.getByText('초대 코드 YORR64')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '닉네임' })).toBeVisible()
})

test('blocks an invalid invite before joining', async ({ page }) => {
  await page.goto('/join?code=bad!')

  await expect(page.getByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
  await expect(page.getByRole('button', { name: '수정한 코드로 참가' })).toBeVisible()
})
