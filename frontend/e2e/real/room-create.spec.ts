import { expect, test } from '@playwright/test'
import { createRoom, uniqueNickname } from '../support/rooms'

test('방을 만들면 방 코드·QR·초대 링크가 있는 로비로 들어간다', async ({ page }) => {
  const nickname = uniqueNickname('host')
  const roomCode = await createRoom(page, nickname)

  await expect(page.getByText(nickname)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '연결됨' })).toBeVisible()

  // QR과 초대 링크는 「초대」 말풍선 안에 있다(로비 인라인 카드에서 옮겨 갔다 — room-and-session.md).
  await page.getByRole('button', { name: '초대' }).click()
  const invite = page.getByRole('dialog', { name: '친구 초대하기' })
  await expect(invite.getByText(roomCode, { exact: true })).toBeVisible()
  await expect(invite.getByRole('img', { name: `방 ${roomCode} 초대 QR 코드` })).toBeVisible()
  await expect(invite.getByText(`/join?code=${roomCode}`)).toBeVisible()
})
