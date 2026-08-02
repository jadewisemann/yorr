import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, ROOM_CODE, scoreBoard, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import {
  createRoomAsHost,
  gameUrl,
  lobbyUrl,
  recordCategory,
  rollDice,
  startHostedGame,
  useSimpleDiceRenderer,
} from '../support/flows'
import { mockRestApi } from '../support/restMock'

/** 호스트 시점의 한 턴 전체: 시작 → 굴리기 → 기록 → 종료 → 대기실 복귀. */

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
  await expect(page.getByText('내 턴이에요')).toBeVisible()
  // 상단 진행 표시는 서버가 준 턴 순서를 그대로 그린다.
  const turnOrder = page.getByRole('list', { name: '턴 순서' })
  await expect(turnOrder.getByRole('listitem')).toHaveCount(2)

  await rollDice(page, server, [5, 5, 5, 5, 5])

  // 굴림이 끝나면 다섯 개 눈이 전부 확정값으로 깔린다.
  await expect(page.getByRole('button', { name: '5 주사위 KEEP' })).toHaveCount(5)

  await recordCategory(page, '요트', 50)
  await server.answerSubmit(HOST_BOARD)

  // 넓은 화면은 하단 바 안내문에도 같은 문장을 병기한다.
  await expect(page.getByText('점수가 반영됐습니다. 다음 턴을 기다립니다.').first()).toBeVisible()
  // score.update가 반영되면 내 턴 카드의 총점이 바뀐다.
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
  await expect(page.getByText('내 턴이에요')).toBeVisible()

  server.send('score.update', { playerId: HOST.id, scoreboard: HOST_BOARD })
  server.send('score.update', { playerId: GUEST.id, scoreboard: GUEST_BOARD })
  server.send('game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: HOST_BOARD.total },
      { rank: 2, playerId: GUEST.id, total: GUEST_BOARD.total },
    ],
  })

  // 결과 화면은 서버가 확정한 순위를 그대로 쓴다(로컬 재계산이 아니다).
  await expect(page.getByRole('heading', { level: 1, name: '1위' })).toBeVisible()
  await expect(page.getByText(`게임 종료, 2명 중 1위, ${HOST_BOARD.total}점`)).toBeVisible()

  const standings = page.getByRole('listitem')
  await expect(standings.first()).toContainText(HOST.nickname)
  await expect(standings.first()).toContainText('WIN')
  await expect(standings.nth(1)).toContainText(GUEST.nickname)

  // 대기실 복귀는 호스트만 누를 수 있고, 실제 이동은 서버의 state.sync가 시킨다.
  const returnToLobby = page.getByRole('button', { name: '대기실로' })
  await expect(returnToLobby).toBeEnabled()
  await returnToLobby.click()

  await expect.poll(() => rest.returnToLobbyCount).toBe(1)
  // 아직 아무 push도 없으면 결과 화면에 머문다 — 혼자 먼저 옮겨가지 않는다.
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
  await expect(page.getByText('내 턴이에요')).toBeVisible()

  server.send('score.update', { playerId: HOST.id, scoreboard: HOST_BOARD })
  server.send('game.over', {
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
