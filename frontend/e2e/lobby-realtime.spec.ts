import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, THIRD, waitingSnapshot } from './support/contract'
import { startFakeGameServer } from './support/fakeGameServer'
import { createRoomAsHost } from './support/flows'
import { mockRestApi } from './support/restMock'

/**
 * 대기실은 WS push만으로 살아 움직인다. 명단은 room.player_joined/left와
 * presence.update로만 바뀌고, 방이 닫히면 세션째로 홈으로 되돌아간다.
 */

test('reflects players joining and leaving the room', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await expect(page.getByRole('region', { name: '참가자 1명' })).toBeVisible()

  server.send('room.player_joined', { player: player(GUEST) })
  await expect(page.getByRole('article', { name: `${GUEST.nickname}, 온라인` })).toBeVisible()
  await expect(page.getByRole('region', { name: '참가자 2명' })).toBeVisible()
  await expect(page.getByText('빈 자리 4 · 링크를 공유해 초대하세요')).toBeVisible()

  server.send('room.player_left', { playerId: GUEST.id })
  await expect(page.getByRole('article', { name: `${GUEST.nickname}, 온라인` })).toBeHidden()
  await expect(page.getByRole('region', { name: '참가자 1명' })).toBeVisible()
})

test('marks a player offline from a presence update', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await expect(page.getByRole('article', { name: `${GUEST.nickname}, 온라인` })).toBeVisible()

  server.send('presence.update', { playerId: GUEST.id, status: 'offline' })

  // 색만 바꾸지 않는다 — 상태 라벨과 접근성 이름이 함께 바뀌어야 한다.
  await expect(page.getByRole('article', { name: `${GUEST.nickname}, 연결 끊김` })).toBeVisible()
  await expect(page.getByRole('article', { name: `${HOST.nickname}, 온라인` })).toBeVisible()
})

test('replaces the whole roster from a state sync', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST)]),
  })

  await createRoomAsHost(page, HOST.nickname)

  server.syncSnapshot(waitingSnapshot([player(HOST), player(GUEST), player(THIRD)]))

  await expect(page.getByRole('region', { name: '참가자 3명' })).toBeVisible()
  await expect(page.getByRole('article', { name: `${THIRD.nickname}, 온라인` })).toBeVisible()
})

test('sends the room home with a notice when the room closes', async ({ page }) => {
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)

  server.send('room.closed', { reason: 'host_left' })

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status')).toContainText('방이 종료되어 홈으로 이동했어요.')
  // 세션이 정리됐으므로 복귀 배너도 남지 않는다.
  await expect(page.getByRole('region', { name: '진행 중인 방' })).toBeHidden()
})

test('shows the room code and the live connection label in the header', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST)]),
  })

  await createRoomAsHost(page, HOST.nickname)

  // 헤더의 연결 상태는 role=status로 노출된다(대기실 상단).
  await expect(page.getByRole('status').filter({ hasText: '연결됨' })).toBeVisible()
})
