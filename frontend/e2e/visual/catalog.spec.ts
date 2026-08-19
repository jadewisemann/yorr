import { expect, type Page, test } from '@playwright/test'

/**
 * 카탈로그 섹션을 하나씩 찍는다. 페이지 전체 한 장이 아닌 이유는 결정적이지 않은
 * 섹션(물리 주사위 렌더러·음성 랩·튜토리얼 가이드)이 섞여 있어서다 — 한 장으로
 * 찍으면 매 실행 diff가 나 도구가 무력해진다.
 */
const SECTIONS = [
  'Screens',
  'Button',
  'Dice',
  'Text field',
  'Alert',
  'Panel',
  'Badge',
  'Player and score',
  'Async states',
  'Game chrome',
  'Game action buttons',
] as const

/**
 * 제외한 섹션과 이유.
 * - `Physics dice renderer` · `Hand callout and voice` — three.js·오디오라 프레임마다 다르다
 * - `Tutorial and tooltip` — 마스코트 가이드가 자체 타이밍으로 움직인다
 * - `Modal` · `Bottom sheet` — 섹션 자체는 버튼 하나뿐이라 볼 것이 없다.
 *   열린 모습은 아래 별도 케이스
 */

async function openCatalog(page: Page) {
  await page.goto('/__dev/components')
  // 카탈로그를 열면 마스코트 가이드가 페이지를 덮은 채 시작한다 — 걷어내야 뒤가 보인다.
  await page.getByRole('button', { name: '연습 그만두기' }).click()
  // 웹폰트가 늦게 붙으면 글자 폭이 바뀌어 diff가 뜬다.
  await page.evaluate(() => document.fonts.ready)
}

test.describe('component catalog', () => {
  for (const section of SECTIONS) {
    test(section, async ({ page }) => {
      await openCatalog(page)
      const panel = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: section, exact: true }) })
      await expect(panel).toHaveScreenshot(`${section.replace(/\s+/g, '-').toLowerCase()}.png`)
    })
  }

  test('Modal open', async ({ page }) => {
    await openCatalog(page)
    await page.getByRole('button', { name: 'Modal 열기' }).click()
    await expect(page.getByRole('dialog')).toHaveScreenshot('modal-open.png')
  })

  test('Bottom sheet open', async ({ page }) => {
    await openCatalog(page)
    await page.getByRole('button', { name: 'Bottom sheet 열기' }).click()
    await expect(page.getByRole('dialog')).toHaveScreenshot('bottom-sheet-open.png')
  })
})
