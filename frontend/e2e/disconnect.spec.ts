import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, waitingSnapshot } from './support/contract'
import { startFakeGameServer } from './support/fakeGameServer'
import { createRoomAsHost, startHostedGame, useSimpleDiceRenderer } from './support/flows'
import { mockRestApi } from './support/restMock'
import { readRoomSession } from './support/roomSession'

/**
 * 연결이 끊겼을 때. 재연결은 자동(1초 뒤 room.join 재전송)이고,
 * 세션이 만료됐다는 error가 오면 재시도 대신 세션을 정리하고 홈으로 보낸다.
 */

test.beforeEach(async ({ page }) => {
  await useSimpleDiceRenderer(page)
})

const roster = [player(HOST), player(GUEST)]

test('shows reconnecting in the lobby and recovers on its own', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot(roster),
  })

  await createRoomAsHost(page, HOST.nickname)
  await expect(page.getByText('연결됨')).toBeVisible()

  server.closeConnection()

  await expect(page.getByText('재연결 중')).toBeVisible()
  // 재연결 중에는 게임을 시작할 수 없다 — 서버 상태와 어긋난 시작이 가장 위험하다.
  await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeDisabled()
  await expect(page.getByText('연결된 뒤 게임을 시작할 수 있어요.')).toBeVisible()

  // 클라이언트가 스스로 다시 붙고 room.join을 한 번 더 보낸다.
  await expect(page.getByText('연결됨')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeEnabled()
  expect(server.connections).toBeGreaterThanOrEqual(2)
  expect(server.joins.length).toBeGreaterThanOrEqual(2)
})

test('locks the dice while reconnecting in game and unlocks after recovery', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot(roster),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)
  const roll = page.getByRole('button', { name: /^굴리기/ })
  await expect(roll).toBeEnabled()

  server.closeConnection()

  await expect(page.getByText('다시 연결하는 중…')).toBeVisible()
  await expect(page.getByText('현재 주사위와 점수는 서버에 저장돼 있습니다.')).toBeVisible()
  await expect(roll).toBeDisabled()

  // 재조인 응답의 스냅샷에는 진행 상태가 없다 — 그래도 지금 들고 있는 라운드를 유지해야 한다.
  await expect(page.getByText('다시 연결하는 중…')).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText('내 턴이에요')).toBeVisible()
  await expect(roll).toBeEnabled()
})

test('ends the session and explains it when the server reports it expired', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot(roster),
  })

  await createRoomAsHost(page, HOST.nickname)
  await expect(page.getByText('연결됨')).toBeVisible()

  server.send('error', {
    code: 'SESSION_EXPIRED',
    message: '세션이 만료되었습니다.',
  })

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status')).toContainText(
    '입장 정보가 만료됐어요. 방에 다시 참가해 주세요.',
  )
  // 만료된 토큰은 저장소에서도 지운다 — 복귀 배너로 다시 제시할 수 없어야 한다.
  await expect(page.getByRole('region', { name: '진행 중인 방' })).toBeHidden()
  expect(await readRoomSession(page)).toBeNull()
})

test('ignores errors that are not about the session', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot(roster),
  })

  await createRoomAsHost(page, HOST.nickname)

  server.send('error', { code: 'RATE_LIMITED', message: '요청이 너무 많습니다.' })

  // 방에서 쫓겨나지 않는다 — 세션을 끝내는 코드만 홈으로 보낸다.
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  await expect(page.getByText('연결됨')).toBeVisible()
})
