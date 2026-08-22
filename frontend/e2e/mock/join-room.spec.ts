import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, ROOM_CODE, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { joinRoomAsGuest } from '../support/flows'
import { mockRestApi } from '../support/restMock'

test('joins through an invite link and waits for the host to start', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await page.goto(`/join?code=${ROOM_CODE}`)
  await expect(page.getByText(`초대 코드 ${ROOM_CODE}`)).toBeVisible()

  await expect(page.getByText('방을 만든 사람이 호스트가 돼요')).toBeHidden()

  await page.getByRole('textbox', { name: '닉네임' }).fill(GUEST.nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_CODE}/lobby$`))
  expect(rest.enterRoomBodies).toEqual([{ nickname: GUEST.nickname, room_id: ROOM_CODE }])

  await expect(page.getByRole('region', { name: '참가자 2명' })).toBeVisible()
  await expect(page.getByRole('article', { name: `${HOST.nickname}, 온라인` })).toBeVisible()
  await expect(page.getByRole('article', { name: `${GUEST.nickname}, 온라인` })).toBeVisible()

  expect(server.joins[0]).toMatchObject({ roomId: ROOM_CODE, sessionToken: GUEST.token })
})

test('keeps the start button host-only for a participant', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await joinRoomAsGuest(page)

  const start = page.getByRole('button', { name: '게임 시작 · 호스트 전용' })
  await expect(start).toBeVisible()
  await expect(start).toBeDisabled()
  await expect(page.getByText('호스트가 게임을 시작하면 자동으로 이동해요.')).toBeVisible()
})

test('explains a missing room and offers another code without opening a socket', async ({
  page,
}) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, { you: GUEST.id })

  await page.goto('/join?code=ZZZZ99')
  await page.getByRole('textbox', { name: '닉네임' }).fill(GUEST.nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    '존재하지 않거나 더 이상 사용할 수 없는 방이에요.',
  )
  expect(rest.enterRoomBodies).toEqual([{ nickname: GUEST.nickname, room_id: 'ZZZZ99' }])

  expect(server.connections).toBe(0)

  await page.getByRole('button', { name: '다른 코드 입력' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page
    .getByRole('button', { name: /코드로 참가$/ })
    .first()
    .click()
  await expect(page.getByRole('textbox', { name: '방 코드' })).toBeVisible()
})

test('blocks joining a room whose game already started', async ({ page }) => {
  await mockRestApi(page, {
    enterRoomFailure: { status: 409, body: 'game_started' },
  })
  const server = await startFakeGameServer(page, { you: GUEST.id })

  await joinRoomAsGuestExpectingFailure(page)

  await expect(page.getByRole('alert')).toHaveText('이미 게임이 시작된 방에는 참가할 수 없어요.')
  expect(server.connections).toBe(0)
})

async function joinRoomAsGuestExpectingFailure(page: Parameters<typeof joinRoomAsGuest>[0]) {
  await page.goto(`/join?code=${ROOM_CODE}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(GUEST.nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()
}
