import { expect, test } from '@playwright/test'
import {
  GUEST,
  HOST,
  player,
  playingSnapshot,
  ROOM_CODE,
  scoreBoard,
  waitingSnapshot,
} from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { activeTurnLabel, gameUrl, joinRoomAsGuest, useSimpleDiceRenderer } from '../support/flows'
import { mockRestApi } from '../support/restMock'

/**
 * 참가자 시점. 참가자는 게임을 시작하지도, 굴리지도 못한다 —
 * 화면 전환과 주사위는 전부 서버 push로만 움직인다.
 */

test.beforeEach(async ({ page }) => {
  await useSimpleDiceRenderer(page)
})

const roster = [player(HOST), player(GUEST)]

test('moves to the game screen when the host starts', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot(roster),
  })

  await joinRoomAsGuest(page)
  await expect(page.getByRole('button', { name: '게임 시작 · 호스트 전용' })).toBeDisabled()

  server.syncSnapshot(playingSnapshot({ players: roster, activePlayerId: HOST.id }))

  await expect(page).toHaveURL(gameUrl)
  await expect(activeTurnLabel(page, HOST.nickname)).toBeVisible()
  // 참가자는 시작 API도, 게임 조회 API도 부르지 않는다(gameId는 호스트만 받는다).
  expect(rest.startGameCount).toBe(0)
  expect(rest.gameFetchCount).toBe(0)
})

test('watches the active player roll without any roll control', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot(roster),
  })

  await joinRoomAsGuest(page)
  server.syncSnapshot(playingSnapshot({ players: roster, activePlayerId: HOST.id }))
  await expect(page).toHaveURL(gameUrl)

  // 내 턴이 아니면 굴리기 CTA 자리는 관전 안내로 바뀐다.
  await expect(page.getByRole('button', { name: /^굴리기/ })).toBeHidden()
  await expect(page.getByText(`${HOST.nickname}(이)가 굴리는 중`)).toBeVisible()

  server.send('game.yacht_dice.dice.broadcast', {
    playerId: HOST.id,
    roundNumber: 1,
    rollCount: 1,
    dice: [6, 6, 6, 6, 6],
    held: [false, false, false, false, false],
  })
  // 관전자 화면은 dice.broadcast만으로는 사발을 쏟지 않는다 — 굴린 사람이 던지는 시점(dice.thrown)에
  // 맞춰야 그 사람의 손 동작과 화면이 어긋나지 않는다(wsEvents.ts v0.6 이력).
  server.send('game.yacht_dice.dice.thrown', { playerId: HOST.id, roundNumber: 1, rollCount: 1 })

  // 서버 브로드캐스트가 관전자 화면에도 그대로 재생된다.
  await expect(page.getByRole('button', { name: '6 주사위 KEEP' })).toHaveCount(5)
  // 굴림은 다음 프레임에 완료 처리된다(PhysicsDiceFallback의 requestAnimationFrame) —
  // 그 전에 dice.hold_changed가 오면 아직 'rolling' phase라 조용히 버려진다.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))

  server.send('game.yacht_dice.dice.hold_changed', {
    playerId: HOST.id,
    roundNumber: 1,
    held: [true, true, false, false, false],
  })
  await expect(page.getByRole('button', { name: '6 주사위 KEEP 해제' })).toHaveCount(2)
})

test('keeps return-to-lobby disabled for a participant on the result screen', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot(roster),
  })

  await joinRoomAsGuest(page)
  server.syncSnapshot(playingSnapshot({ players: roster, activePlayerId: HOST.id }))
  await expect(page).toHaveURL(gameUrl)

  const hostBoard = scoreBoard({ yacht: 50 })
  const guestBoard = scoreBoard({ threes: 9 })
  server.send('game.yacht_dice.score.update', { playerId: HOST.id, scoreboard: hostBoard })
  server.send('game.yacht_dice.score.update', { playerId: GUEST.id, scoreboard: guestBoard })
  server.send('game.yacht_dice.game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: hostBoard.total },
      { rank: 2, playerId: GUEST.id, total: guestBoard.total },
    ],
  })

  await expect(page.getByRole('heading', { level: 1, name: '2위' })).toBeVisible()
  await expect(page.getByRole('button', { name: '대기실로' })).toBeDisabled()
  await expect(page.getByText('방장이 대기실로 옮기기를 기다리는 중')).toBeVisible()
  expect(rest.returnToLobbyCount).toBe(0)
})

test('follows the host back to the lobby after the game', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot(roster),
  })

  await joinRoomAsGuest(page)
  server.syncSnapshot(playingSnapshot({ players: roster, activePlayerId: HOST.id }))
  await expect(page).toHaveURL(gameUrl)

  server.send('game.yacht_dice.game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: 50 },
      { rank: 2, playerId: GUEST.id, total: 9 },
    ],
  })
  await expect(page.getByRole('heading', { level: 1, name: '2위' })).toBeVisible()

  server.syncSnapshot(waitingSnapshot(roster))

  await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_CODE}/lobby$`))
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
})
