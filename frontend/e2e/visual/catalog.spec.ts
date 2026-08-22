import { expect, type Page, test } from '@playwright/test'

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

async function openCatalog(page: Page) {
  await page.goto('/__dev/components')

  await page.getByRole('button', { name: '연습 그만두기' }).click()

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
