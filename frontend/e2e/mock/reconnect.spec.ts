import { expect, test } from '@playwright/test'
import {
  GUEST,
  HOST,
  player,
  playingSnapshot,
  ROOM_CODE,
  waitingSnapshot,
} from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import {
  activeTurnLabel,
  gameUrl,
  lobbyUrl,
  myTurnLabel,
  useSimpleDiceRenderer,
} from '../support/flows'
import { mockRestApi } from '../support/restMock'
import {
  playingSession,
  readRoomSession,
  seedRoomSession,
  storedSession,
} from '../support/roomSession'

/**
 * 게임 중 새로고침 복원. sessionStorage에 세션이 남아 있어도 자동으로 재입장하지 않는다 —
 * 사용자가 "이어서 하기"를 고른 뒤에야 토큰을 서버에 제시한다(roomSessionStorage 주석).
 */

test.beforeEach(async ({ page }) => {
  await useSimpleDiceRenderer(page)
})

const roster = [player(HOST), player(GUEST)]

test('resumes a game in progress from the stored session', async ({ page }) => {
  await mockRestApi(page)
  const snapshot = playingSnapshot({ players: roster, activePlayerId: HOST.id })
  await seedRoomSession(page, playingSession(snapshot))
  const server = await startFakeGameServer(page, { you: HOST.id, snapshot })

  await page.goto('/')

  const banner = page.getByRole('region', { name: '진행 중인 방' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('진행 중인 게임이 있어요')
  await expect(banner).toContainText(`${ROOM_CODE} · ${HOST.nickname}`)
  // 복원만으로는 소켓을 열지 않는다.
  expect(server.connections).toBe(0)

  await banner.getByRole('button', { name: '이어서 하기' }).click()

  // 게임 중이던 세션은 대기실이 아니라 게임 화면으로 돌아간다.
  await expect(page).toHaveURL(gameUrl)
  await expect(myTurnLabel(page)).toBeVisible()

  // 재조인은 저장된 세션 토큰을 그대로 제시한다(서버가 정체성을 복원하는 근거).
  expect(server.joins).toHaveLength(1)
  expect(server.joins[0]).toMatchObject({
    roomId: ROOM_CODE,
    nickname: HOST.nickname,
    sessionToken: HOST.token,
  })
})

test('resumes a lobby session back into the lobby', async ({ page }) => {
  await mockRestApi(page)
  const snapshot = waitingSnapshot(roster)
  await seedRoomSession(page, storedSession({ snapshot }))
  const server = await startFakeGameServer(page, { you: HOST.id, snapshot })

  await page.goto('/')
  await page.getByRole('button', { name: '이어서 하기' }).click()

  await expect(page).toHaveURL(lobbyUrl)
  await expect(page.getByRole('region', { name: '참가자 2명' })).toBeVisible()
  await expect(page.getByText('연결됨')).toBeVisible()
  expect(server.joins).toHaveLength(1)
})

test('survives a reload in the middle of a game', async ({ page }) => {
  await mockRestApi(page)
  const snapshot = playingSnapshot({ players: roster, activePlayerId: HOST.id })
  await seedRoomSession(page, playingSession(snapshot))
  const server = await startFakeGameServer(page, { you: HOST.id, snapshot })

  await page.goto('/')
  await page.getByRole('button', { name: '이어서 하기' }).click()
  await expect(page).toHaveURL(gameUrl)
  await expect(myTurnLabel(page)).toBeVisible()

  await page.reload()

  // 새로고침 직후에는 다시 복귀 확인 상태로 멈춘다 — 화면은 방 URL이어도 세션은 재개 대기다.
  await expect(page.getByRole('region', { name: '진행 중인 방' })).toBeVisible()
  await page.getByRole('button', { name: '이어서 하기' }).click()

  await expect(page).toHaveURL(gameUrl)
  await expect(myTurnLabel(page)).toBeVisible()
  expect(server.connections).toBeGreaterThanOrEqual(2)
})

test('drops the stored session when leaving from the resume banner', async ({ page }) => {
  const rest = await mockRestApi(page)
  await seedRoomSession(page, storedSession({ snapshot: waitingSnapshot(roster) }))
  await startFakeGameServer(page, { you: HOST.id })

  await page.goto('/')
  const banner = page.getByRole('region', { name: '진행 중인 방' })
  await banner.getByRole('button', { name: '나가기' }).click()

  await expect(banner).toBeHidden()
  await expect.poll(() => rest.leaveCount).toBe(1)
  expect(await readRoomSession(page)).toBeNull()
})

test('ignores a stored session that does not match its own room', async ({ page }) => {
  await mockRestApi(page)
  // 스냅샷의 roomId가 세션의 방과 다르면 저장소 검증에서 걸러진다.
  await seedRoomSession(page, {
    ...storedSession({ snapshot: waitingSnapshot(roster, 'OTHER1') }),
  })
  await startFakeGameServer(page, { you: HOST.id })

  await page.goto('/')

  await expect(page.getByRole('region', { name: '진행 중인 방' })).toBeHidden()
  await expect(page.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()
})

test('never sends the guest token before resuming', async ({ page }) => {
  await mockRestApi(page)
  const snapshot = playingSnapshot({ players: roster, activePlayerId: HOST.id })
  await seedRoomSession(page, playingSession(snapshot, GUEST))
  const server = await startFakeGameServer(page, { you: GUEST.id, snapshot })

  await page.goto('/')
  await expect(page.getByRole('region', { name: '진행 중인 방' })).toBeVisible()
  expect(server.clientMessages()).toHaveLength(0)

  await page.getByRole('button', { name: '이어서 하기' }).click()
  await expect(page).toHaveURL(gameUrl)
  await expect(activeTurnLabel(page, HOST.nickname)).toBeVisible()
  expect(server.joins[0]?.sessionToken).toBe(GUEST.token)
})
