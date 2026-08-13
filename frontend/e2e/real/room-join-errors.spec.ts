import { expect, test } from '@playwright/test'
import { createRoom, enterRoomViaApi, uniqueNickname } from '../support/rooms'

/**
 * 서버가 실제로 반환하는 참가 에러의 UX 를 검증한다.
 * 중복 닉네임은 서버가 허용(200)하는 것을 실측으로 확인해 시나리오에서 제외했다.
 */

test('존재하지 않는 방 코드는 참가를 막고 코드 수정 경로를 준다', async ({ page }) => {
  // 코드는 서버 생성 6자 영숫자. 우연히 존재할 확률은 무시할 수준이다.
  await page.goto('/join?code=ZZZ999')
  await page.getByRole('textbox', { name: '닉네임' }).fill(uniqueNickname('walker'))
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    '존재하지 않거나 더 이상 사용할 수 없는 방이에요.',
  )
  await expect(page.getByRole('button', { name: '다른 코드 입력' })).toBeVisible()
})

test('정원이 찬 방에는 참가할 수 없다는 안내가 뜬다', async ({ page, request }) => {
  const roomCode = await createRoom(page, uniqueNickname('host'))

  // 최대 6명 — REST 직행으로 남은 5자리를 채운다 (UI 로 5명 로그인은 낭비).
  for (let seat = 0; seat < 5; seat += 1) {
    await enterRoomViaApi(request, { nickname: uniqueNickname(`seat${seat}`), room_id: roomCode })
  }

  const latePage = await page.context().newPage()
  await joinRoomExpectingError(latePage, roomCode)
})

async function joinRoomExpectingError(page: import('@playwright/test').Page, roomCode: string) {
  await page.goto(`/join?code=${roomCode}`)
  await page.getByRole('textbox', { name: '닉네임' }).fill(uniqueNickname('late'))
  await page.getByRole('button', { name: '대기실 입장' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    '방이 가득 찼어요. 다른 초대 코드로 참가해 주세요.',
  )
  await expect(page.getByRole('button', { name: '다른 코드 입력' })).toBeVisible()
}
