import { expect, test } from '@playwright/test'
import { createRoom, joinRoom, uniqueNickname } from '../support/rooms'

test('호스트가 시작하면 두 플레이어 모두 게임 화면으로 전환된다', async ({
  page: hostPage,
  browser,
}) => {
  const roomCode = await createRoom(hostPage, uniqueNickname('host'))

  const guestContext = await browser.newContext()
  try {
    const guestPage = await guestContext.newPage()
    await joinRoom(guestPage, roomCode, uniqueNickname('guest'))
    await expect(hostPage.getByRole('region', { name: '참가자 2명' })).toBeVisible()

    const startButton = hostPage.getByRole('button', { name: '게임 시작' })
    await expect(startButton).toBeEnabled()
    await startButton.click()

    // 호스트는 REST 응답으로, 게스트는 WS 브로드캐스트로 전환된다.
    await hostPage.waitForURL(/\/rooms\/[^/]+\/game/)
    await guestPage.waitForURL(/\/rooms\/[^/]+\/game/, { timeout: 15_000 })
    await expect(hostPage.getByRole('heading', { name: /요르 게임 진행 중/ })).toBeAttached()
    await expect(guestPage.getByRole('heading', { name: /요르 게임 진행 중/ })).toBeAttached()

    // 턴 순서 일치: 첫 굴림 전 탭 타깃은 활성 플레이어에게만 뜬다 — 정확히 한쪽만 보여야 한다.
    await expect(async () => {
      const [hostRolls, guestRolls] = await Promise.all([
        hostPage.getByRole('button', { name: '주사위 굴리기' }).isVisible(),
        guestPage.getByRole('button', { name: '주사위 굴리기' }).isVisible(),
      ])
      expect(hostRolls !== guestRolls).toBe(true)
    }).toPass({ timeout: 10_000 })
  } finally {
    await guestContext.close()
  }
})
