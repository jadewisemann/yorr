import { expect, test } from '@playwright/test'
import { createRoom, uniqueNickname } from '../support/rooms'

test('방을 만들면 방 코드·QR·초대 링크가 있는 로비로 들어간다', async ({ page }) => {
  const nickname = uniqueNickname('host')
  const roomCode = await createRoom(page, nickname)

  await expect(page.getByText(roomCode, { exact: true })).toBeVisible()

  // QR·초대 링크는 인라인 카드가 아니라 초대 버튼의 말풍선 안에 있다
  // (S15P11A406-203, e2e/mock/create-room.spec.ts 와 같은 계약).
  await page.getByRole('button', { name: '초대' }).click()
  const invite = page.getByRole('dialog', { name: '친구 초대하기' })
  await expect(invite.getByRole('img', { name: `방 ${roomCode} 초대 QR 코드` })).toBeVisible()
  await expect(invite.getByText(`/join?code=${roomCode}`)).toBeVisible()
  await invite.getByRole('button', { name: '닫기' }).click()

  // 참가자 목록은 WS 스냅숏(state.sync)이 와야 그려진다 — 실서버 WS 연결 검증의 핵심.
  await expect(page.getByText(nickname)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '연결됨' })).toBeVisible()
})
