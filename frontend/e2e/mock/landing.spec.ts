import { expect, test } from '@playwright/test'

/**
 * 랜딩은 760px에서 마크업이 갈린다 — 좁으면 스와이프 + 바텀시트, 넓으면 화살표 + 팝오버.
 * 두 구현이 같은 tablist·dialog 계약을 지키는지 확인해야 하므로 역할로만 찾는다.
 */

/** 코드 입력은 팝오버·바텀시트 안에 있다. 배경에 같은 이름의 버튼이 있어 항상 좁혀 찾는다. */
function codeDialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog', { name: '초대받은 방에 참가' })
}

test('opens the game list from the hero play button', async ({ page }) => {
  await page.goto('/')

  // 히어로의 선택지는 플레이 하나뿐이다 — 게임 비교는 카드 목록 뷰가 맡는다.
  await page.getByRole('button', { name: '플레이', exact: true }).click()

  await expect(page).toHaveURL(/view=games/)
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  await expect(page.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()
  // 준비 중인 게임은 같은 목록에서 잠긴 버튼으로 선다.
  await expect(page.getByRole('button', { name: '준비 중인 게임' }).first()).toBeDisabled()
})

test('returns to the hero with browser back from the game list', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '플레이', exact: true }).click()
  await expect(page.getByRole('heading', { name: '탁구' })).toBeVisible()

  // 목록 진입은 push다 — 뒤로가기는 목록을 되짚지 않고 히어로로 돌아온다.
  await page.goBack()
  await expect(page.getByRole('button', { name: '플레이', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '탁구' })).toBeHidden()
})

test('pulls the room code out of a pasted invite link', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('button', { name: /코드로 참가$/ })
    .first()
    .click()
  const dialog = codeDialog(page)
  const input = dialog.getByRole('textbox', { name: '방 코드' })
  const join = dialog.getByRole('button', { name: '코드로 참가' })

  await expect(join).toBeDisabled()

  // 초대 링크를 통째로 붙여넣는 흐름. 링크가 그대로 정규화되면
  // 'HTTPSYORRAPP' 같은 값이 4~12자 규칙을 통과해 없는 방으로 참가하게 된다.
  await input.fill('https://yorr.app/join?code=YORR64')

  await expect(input).toHaveValue('YORR64')
  await expect(join).toBeEnabled()
})

test('keeps joining blocked for a link that carries no code', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('button', { name: /코드로 참가$/ })
    .first()
    .click()
  const dialog = codeDialog(page)

  await dialog.getByRole('textbox', { name: '방 코드' }).fill('https://yorr.app/join')

  await expect(dialog.getByRole('textbox', { name: '방 코드' })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: '코드로 참가' })).toBeDisabled()
})

test('carries the typed code into the invite entry screen', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('button', { name: /코드로 참가$/ })
    .first()
    .click()
  const dialog = codeDialog(page)
  await dialog.getByRole('textbox', { name: '방 코드' }).fill('yorr64')
  await dialog.getByRole('button', { name: '코드로 참가' }).click()

  await expect(page.getByText('초대 코드 YORR64')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '닉네임' })).toBeVisible()
})
