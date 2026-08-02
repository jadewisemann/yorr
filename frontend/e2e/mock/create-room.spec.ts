import { expect, test } from '@playwright/test'
import { HOST, player, ROOM_CODE, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { createRoomAsHost } from '../support/flows'
import { mockRestApi } from '../support/restMock'

/**
 * 호스트의 첫 흐름: 랜딩 → 방 만들기 → 닉네임 → 대기실.
 * 방 코드는 REST(POST /rooms)가 주고, 참가자 명단은 WS(room.joined)가 준다 —
 * 두 경로가 같은 방을 가리키는지가 이 스펙의 핵심이다.
 */

test('creates a room with the suggested nickname and lands in the lobby', async ({ page }) => {
  const rest = await mockRestApi(page)
  const server = await startFakeGameServer(page, { you: HOST.id })

  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()

  // 닉네임을 비워두면 placeholder에 보이는 제안 닉네임으로 입장한다.
  const field = page.getByRole('textbox', { name: '닉네임' })
  await expect(field).toHaveValue('')
  const suggestion = (await field.getAttribute('placeholder')) ?? ''
  expect(suggestion).not.toBe('')

  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_CODE}/lobby$`))
  await expect(page.getByRole('heading', { name: '대기실' })).toBeVisible()

  // 서버에는 제안 닉네임이 그대로 실려 나가야 한다.
  expect(rest.enterRoomBodies).toEqual([{ nickname: suggestion }])

  // 실시간 채널까지 붙고 나서야 대기실이 완성된다.
  await expect(page.getByText('연결됨')).toBeVisible()
  expect(server.joins).toHaveLength(1)
  expect(server.joins[0]).toMatchObject({ roomId: ROOM_CODE, sessionToken: HOST.token })

  await expect(page.getByRole('article', { name: `${suggestion}, 온라인` })).toBeVisible()
})

test('shows the room code, invite panel and an open seat hint in the lobby', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST)]),
  })

  await createRoomAsHost(page, '요르호스트')

  const invite = page.getByRole('region', { name: '친구 초대하기' })
  await expect(invite.getByText(ROOM_CODE, { exact: true })).toBeVisible()
  await expect(invite.getByText(`/join?code=${ROOM_CODE}`)).toBeVisible()
  await expect(invite.getByRole('button', { name: '링크 복사' })).toBeVisible()

  await expect(page.getByRole('region', { name: '참가자 1명' })).toBeVisible()
  await expect(page.getByText('빈 자리 5 · 링크를 공유해 초대하세요')).toBeVisible()
})

test('lets the host start with a single player in the room', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST)]),
  })

  await createRoomAsHost(page, HOST.nickname)

  // 호스트 혼자여도 시작할 수 있다(서버 검증도 1명부터 허용한다).
  const start = page.getByRole('button', { name: '게임 시작', exact: true })
  await expect(start).toBeEnabled()
  await expect(page.getByText('명부터 시작할 수 있어요.')).toBeHidden()
})

test('rejects a nickname longer than the limit before calling the API', async ({ page }) => {
  const rest = await mockRestApi(page)
  await startFakeGameServer(page, { you: HOST.id })

  await page.goto('/')
  await page.getByRole('button', { name: '요트 다이스 플레이' }).click()
  await page.getByRole('textbox', { name: '닉네임' }).fill('가나다라마바사아자차카타파')
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page.getByRole('alert')).toHaveText('닉네임은 12자 이하로 입력해 주세요.')
  expect(rest.enterRoomBodies).toHaveLength(0)
  await expect(page).toHaveURL(/\/join/)
})
