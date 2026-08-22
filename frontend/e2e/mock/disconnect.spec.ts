import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import {
  createRoomAsHost,
  myTurnLabel,
  startHostedGame,
  useSimpleDiceRenderer,
} from '../support/flows'
import { mockRestApi } from '../support/restMock'
import { readRoomSession } from '../support/roomSession'

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

  await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeDisabled()
  await expect(page.getByText('연결된 뒤 게임을 시작할 수 있어요.')).toBeVisible()

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

  await expect(page.getByText('다시 연결하는 중…')).toBeHidden({ timeout: 15_000 })
  await expect(myTurnLabel(page)).toBeVisible()
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

  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  await expect(page.getByText('연결됨')).toBeVisible()
})
