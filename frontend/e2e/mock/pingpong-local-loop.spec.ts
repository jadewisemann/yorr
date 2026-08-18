import { expect, test } from '@playwright/test'

/**
 * 로컬 탁구의 프레임 루프가 실제로 도는지 본다.
 *
 * 왜 e2e인가: 이 루프는 `requestAnimationFrame` 위에 서 있어서 **합성되는 창**이 없으면
 * 한 프레임도 돌지 않는다(숨겨진 페이지는 rAF가 멈춘다). jsdom에는 WebGL이 없어
 * `createScene`이 던지고 `glFailed` 경로로 빠지므로 단위 테스트로도 닿지 않는다.
 * headless Chromium은 정상적으로 합성하므로 여기가 유일하게 루프를 볼 수 있는 자리다.
 *
 * 도메인 세그먼트 재편 때 이 루프를 `useLocalPingPongGame` 훅으로 옮겼다. 회귀하면
 * 코트는 그려지지만 공이 서지 않는다 — 화면은 정상처럼 보이므로 눈으로는 못 잡는다.
 */
test.describe('로컬 탁구 프레임 루프', () => {
  test('3D 코트가 서고 게임 시계가 흐른다', async ({ page }) => {
    await page.goto('/pingpong')

    const canvas = page.getByLabel('로컬 3D 탁구 코트')
    await expect(canvas).toBeVisible()

    // WebGL 컨텍스트가 살아 있고 리사이즈가 반영됐는지 — 여기까지는 effect 본문이 실행됐다는 뜻이다.
    const backing = await canvas.evaluate((element) => {
      const node = element as HTMLCanvasElement
      const gl = node.getContext('webgl2') ?? node.getContext('webgl')
      return { width: node.width, height: node.height, alive: !!gl && !gl.isContextLost() }
    })
    expect(backing.alive).toBe(true)
    expect(backing.width).toBeGreaterThan(0)

    // 루프가 도는지 — rAF 호출을 센다. 멈춰 있으면 0이다.
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

    /*
     * `createLocalGame`은 `countdown: 0`으로 시작하고, 값을 올리는 곳은 프레임 루프가 부르는
     * `advanceLocalGame` 하나뿐이다(localGame.ts의 serve 타이머). 그래서 이 오버레이가
     * **나타나는 것** 자체가 루프가 돌았다는 증거다.
     *
     * 스윙에 피드백 문구가 뜨는 것으로는 확인할 수 없다 — 그건 keydown 핸들러가 직접
     * 세팅하므로 루프를 떼도 통과한다(실제로 그렇게 헛돌았다).
     */
    await expect(page.locator('strong.text-\\[14vh\\]')).toBeVisible({ timeout: 6_000 })
  })
})
