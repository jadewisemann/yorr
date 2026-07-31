import { expect, test } from '@playwright/test'
import { createRoom, joinRoom, uniqueNickname } from '../support/rooms'

test('게스트가 초대 코드로 참가하면 양쪽 로비에 두 플레이어가 보인다', async ({
  page: hostPage,
  browser,
}) => {
  const hostNickname = uniqueNickname('host')
  const guestNickname = uniqueNickname('guest')
  const roomCode = await createRoom(hostPage, hostNickname)

  const guestContext = await browser.newContext()
  try {
    const guestPage = await guestContext.newPage()
    await joinRoom(guestPage, roomCode, guestNickname)

    // 게스트 쪽: REST 응답 + 자기 스냅숏.
    await expect(guestPage.getByText('현재 인원 2 / 최대 6명')).toBeVisible()
    await expect(guestPage.getByText(hostNickname)).toBeVisible()
    await expect(guestPage.getByText(guestNickname)).toBeVisible()

    // 호스트 쪽: 서버 브로드캐스트로만 갱신된다 — 참가 이벤트 전파 검증.
    await expect(hostPage.getByText('현재 인원 2 / 최대 6명')).toBeVisible()
    await expect(hostPage.getByText(guestNickname)).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
