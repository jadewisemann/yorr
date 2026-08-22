import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, ROOM_CODE, scoreBoard, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import {
  createRoomAsHost,
  gameUrl,
  lobbyUrl,
  myTurnLabel,
  recordCategory,
  rollDice,
  startHostedGame,
  useSimpleDiceRenderer,
} from '../support/flows'
import { mockRestApi } from '../support/restMock'

test.beforeEach(async ({ page }) => {
  await useSimpleDiceRenderer(page)
})

const HOST_BOARD = scoreBoard({ yacht: 50 })
const GUEST_BOARD = scoreBoard({ ones: 3 })

test('plays a turn from the start button to the recorded score', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)

  expect(rest.startGameCount).toBe(1)
  await expect(myTurnLabel(page)).toBeVisible()

  const turnOrder = page.getByRole('list', { name: '턴 순서' })
  await expect(turnOrder.getByRole('listitem')).toHaveCount(2)

  await rollDice(page, server, [5, 5, 5, 5, 5])

  await expect(page.getByRole('button', { name: '5 주사위 KEEP' })).toHaveCount(5)

  await recordCategory(page, '요트', 50)
  await server.answerSubmit(HOST_BOARD)

  await expect(page.getByText('점수가 반영됐습니다. 다음 턴을 기다립니다.').first()).toBeVisible()

  await expect(turnOrder.getByText('50')).toBeVisible()
  await expect(page.getByRole('button', { name: /^굴리기/ })).toBeHidden()
})

test('shows the final standings and returns the room to the lobby', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)
  await expect(myTurnLabel(page)).toBeVisible()

  server.send('game.yacht_dice.score.update', { playerId: HOST.id, scoreboard: HOST_BOARD })
  server.send('game.yacht_dice.score.update', { playerId: GUEST.id, scoreboard: GUEST_BOARD })
  server.send('game.yacht_dice.game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: HOST_BOARD.total },
      { rank: 2, playerId: GUEST.id, total: GUEST_BOARD.total },
    ],
  })

  await expect(page.getByRole('heading', { level: 1, name: '1위' })).toBeVisible()
  await expect(page.getByText(`게임 종료, 2명 중 1위, ${HOST_BOARD.total}점`)).toBeVisible()

  const standings = page.getByRole('listitem')
  await expect(standings.first()).toContainText(HOST.nickname)
  await expect(standings.first()).toContainText('WIN')
  await expect(standings.nth(1)).toContainText(GUEST.nickname)

  const returnToLobby = page.getByRole('button', { name: '대기실로' })
  await expect(returnToLobby).toBeEnabled()
  await returnToLobby.click()

  await expect.poll(() => rest.returnToLobbyCount).toBe(1)

  await expect(page).toHaveURL(gameUrl)

  server.syncSnapshot(waitingSnapshot([player(HOST), player(GUEST)]))

  await expect(page).toHaveURL(lobbyUrl)
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()
  await expect(page.getByRole('region', { name: '참가자 2명' })).toBeVisible()
})

test('opens the full score matrix from the result screen', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)
  await expect(myTurnLabel(page)).toBeVisible()

  server.send('game.yacht_dice.score.update', { playerId: HOST.id, scoreboard: HOST_BOARD })
  server.send('game.yacht_dice.game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: HOST_BOARD.total },
      { rank: 2, playerId: GUEST.id, total: 0 },
    ],
  })

  await expect(page.getByRole('heading', { level: 1, name: '1위' })).toBeVisible()
  await page.getByRole('button', { name: '전체 점수표 보기' }).click()

  const matrix = page.getByRole('dialog', { name: '전체 점수표' })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByText('요트')).toBeVisible()
})

test('keeps the room code out of the game screen url after a refresh-free start', async ({
  page,
}) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)

  await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_CODE}/game$`))
  await expect(page.getByRole('heading', { level: 1 })).toContainText('요르 게임 진행 중')
})
