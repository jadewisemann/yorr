import { expect, test } from '@playwright/test'
import { GUEST, HOST, player, ROOM_CODE, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { mockRestApi } from '../support/restMock'

/**
 * 형식이 틀린 초대 코드는 REST 요청을 보내기 전에 화면에서 막는다(InvalidInvitePage).
 * smoke가 "막힌다"까지 보므로, 여기서는 고쳐서 실제로 들어가는 데까지 이어 본다.
 */

test('recovers from a malformed invite code and joins with the corrected one', async ({ page }) => {
  const rest = await mockRestApi(page)
  await startFakeGameServer(page, {
    you: GUEST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await page.goto('/join?code=abc')

  await expect(page.getByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
  const field = page.getByRole('textbox', { name: '초대 코드' })
  // 링크의 코드는 대문자로 정규화된 뒤 그대로 입력칸에 남아 고칠 수 있다.
  await expect(field).toHaveValue('ABC')
  await expect(page.getByRole('alert')).toHaveText(
    '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.',
  )
  // 형식이 틀린 코드로는 서버를 부르지 않는다.
  expect(rest.enterRoomBodies).toHaveLength(0)

  await field.fill('yorr64')
  await page.getByRole('button', { name: '수정한 코드로 참가' }).click()

  // 소문자로 고쳐도 정규화되어 초대 코드 화면으로 넘어간다.
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
