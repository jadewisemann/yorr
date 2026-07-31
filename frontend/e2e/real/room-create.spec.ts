import { expect, test } from '@playwright/test'
import { createRoom, uniqueNickname } from '../support/rooms'

test('방을 만들면 방 코드·QR·초대 링크가 있는 로비로 들어간다', async ({ page }) => {
  const nickname = uniqueNickname('host')
  const roomCode = await createRoom(page, nickname)

  await expect(page.getByText(roomCode, { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: `방 ${roomCode} 초대 QR 코드` })).toBeVisible()
  await expect(page.getByText(`/join?code=${roomCode}`)).toBeVisible()

  // 참가자 목록은 WS 스냅숏(state.sync)이 와야 그려진다 — 실서버 WS 연결 검증의 핵심.
  await expect(page.getByText(nickname)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '연결됨' })).toBeVisible()
})
