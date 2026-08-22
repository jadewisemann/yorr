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

  await expect(page.getByRole('button', { name: /^굴리기/ })).toBeHidden()
  await expect(page.getByText(`${HOST.nickname}(이)가 굴리는 중`)).toBeVisible()

  server.send('game.yacht_dice.dice.broadcast', {
    playerId: HOST.id,
    roundNumber: 1,
    rollCount: 1,
    dice: [6, 6, 6, 6, 6],
    held: [false, false, false, false, false],
  })

  server.send('game.yacht_dice.dice.thrown', { playerId: HOST.id, roundNumber: 1, rollCount: 1 })

  await expect(page.getByRole('button', { name: '6 주사위 KEEP' })).toHaveCount(5)

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
