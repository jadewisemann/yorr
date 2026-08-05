import { expect, test } from '@playwright/test'

/**
 * 랜딩은 760px에서 마크업이 갈린다 — 좁으면 스와이프 + 바텀시트, 넓으면 화살표 + 팝오버.
 * 두 구현이 같은 tablist·dialog 계약을 지키는지 확인해야 하므로 역할로만 찾는다.
 */

/** 코드 입력은 팝오버·바텀시트 안에 있다. 배경에 같은 이름의 버튼이 있어 항상 좁혀 찾는다. */
function codeDialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog', { name: '초대받은 방에 참가' })
}

test('switches the hero and the call to action when another game is picked', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  await expect(page.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()

  await page.getByRole('tab', { name: /라이어스 다이스/ }).click()

  // 준비 중인 게임은 제목과 CTA가 함께 바뀐다. 하나만 바뀌면 안내가 어긋난다.
  await expect(page.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
  await expect(page.getByRole('button', { name: '준비 중인 게임' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '요트 다이스 플레이' })).toBeHidden()
})

test('moves between games with the arrow keys and wraps at the end', async ({ page }) => {
  await page.goto('/')

  const firstTab = page.getByRole('tab', { name: /요트 다이스/ })
  await firstTab.focus()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()

  // 첫 탭에서 왼쪽으로 가면 마지막으로 감싼다(WAI-ARIA tabs 패턴).
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('heading', { name: '낚시' })).toBeVisible()

  await page.keyboard.press('Home')
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
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
