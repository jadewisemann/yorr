import { expect, test } from '@playwright/test'

test.describe('로컬 탁구 프레임 루프', () => {
  test('3D 코트가 서고 게임 시계가 흐른다', async ({ page }) => {
    await page.goto('/pingpong')

    const canvas = page.getByLabel('로컬 3D 탁구 코트')
    await expect(canvas).toBeVisible()

    const backing = await canvas.evaluate((element) => {
      const node = element as HTMLCanvasElement
      const gl = node.getContext('webgl2') ?? node.getContext('webgl')
      return { width: node.width, height: node.height, alive: !!gl && !gl.isContextLost() }
    })
    expect(backing.alive).toBe(true)
    expect(backing.width).toBeGreaterThan(0)

    const frames = await page.evaluate(async () => {
      const original = window.requestAnimationFrame
      let calls = 0
      window.requestAnimationFrame = (callback) => {
        calls += 1
        return original.call(window, callback)
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      window.requestAnimationFrame = original
      return calls
    })
    expect(frames).toBeGreaterThan(10)
  })

  test('서브 카운트다운이 나타난다 — 루프만이 이 값을 올린다', async ({ page }) => {
    await page.goto('/pingpong')
    await expect(page.getByLabel('로컬 3D 탁구 코트')).toBeVisible()

    await expect(page.locator('strong.text-\\[14vh\\]')).toBeVisible({ timeout: 6_000 })
  })
})
