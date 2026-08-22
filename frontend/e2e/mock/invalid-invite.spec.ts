import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, ROOM_CODE, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { mockRestApi } from '../support/restMock'

test('recovers from a malformed invite code and joins with the corrected one', async ({ page }) => {
  const rest = await mockRestApi(page)
  await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await page.goto('/join?code=abc')

  await expect(page.getByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
  const field = page.getByRole('textbox', { name: '초대 코드' })

  await expect(field).toHaveValue('ABC')
  await expect(page.getByRole('alert')).toHaveText(
    '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.',
  )

  expect(rest.enterRoomBodies).toHaveLength(0)

  await field.fill('yorr64')
  await page.getByRole('button', { name: '수정한 코드로 참가' }).click()

  await expect(page).toHaveURL(new RegExp(`/join\\?code=${ROOM_CODE}$`))
  await expect(page.getByText(`초대 코드 ${ROOM_CODE}`)).toBeVisible()

  await page.getByRole('textbox', { name: '닉네임' }).fill(GUEST.nickname)
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page).toHaveURL(new RegExp(`/rooms/${ROOM_CODE}/lobby$`))
  expect(rest.enterRoomBodies).toEqual([{ nickname: GUEST.nickname, room_id: ROOM_CODE }])
})

test('keeps the invite screen when the correction is still malformed', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, { you: GUEST.id })

  await page.goto('/join?code=%25%25')

  const field = page.getByRole('textbox', { name: '초대 코드' })
  await field.fill('yo!')
  await page.getByRole('button', { name: '수정한 코드로 참가' }).click()

  await expect(page.getByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText(
    '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.',
  )
})

test('leaves the invite screen for the landing page', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, { you: GUEST.id })

  await page.goto('/join?code=nope!')
  await page.getByRole('button', { name: '홈으로' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
})
