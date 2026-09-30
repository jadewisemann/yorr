import { expect, test } from '@playwright/test'

test.describe('로컬 탁구 프레임 루프', () => {
  // 3D 첫 장면(15초)과 느린 게임 시계(25초)를 합치면 기본 30초를 넘는다.
  test.describe.configure({ timeout: 60_000 })

  test('3D 코트가 서고 게임 시계가 흐른다', async ({ page }) => {
    await page.goto('/pingpong')

    const canvas = page.getByLabel('로컬 3D 탁구 코트')
    // GPU 없는 러너의 소프트웨어 GL은 첫 장면을 세우는 데만 몇 초가 걸린다(webkit이 특히 느리다).
    await expect(canvas).toBeVisible({ timeout: 15_000 })

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
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      window.requestAnimationFrame = original
      return calls
    })
    // 루프가 **돈다**는 것만 본다. GPU 없는 CI 러너는 소프트웨어 GL이라 3D 코트가 초당 몇 장에
    // 그친다(600ms에 4~7장 실측) — 프레임률 기준을 걸면 기계 성능을 재는 불안정한 테스트가 된다.
    expect(frames).toBeGreaterThanOrEqual(3)
  })

  test('서브 카운트다운이 나타난다 — 루프만이 이 값을 올린다', async ({ page }) => {
    await page.goto('/pingpong')
    await expect(page.getByLabel('로컬 3D 탁구 코트')).toBeVisible({ timeout: 15_000 })

    // 게임 시계는 프레임이 올린다 — 소프트웨어 GL에서는 프레임이 드물어 같은 시계가 몇 배 느리게
    // 흐른다. 여기서 보는 것은 "루프만이 이 값을 올린다"이지 속도가 아니다.
    await expect(page.locator('strong.text-\\[14vh\\]')).toBeVisible({ timeout: 25_000 })
  })
})
