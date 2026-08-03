import { expect, type Page, test } from '@playwright/test'
import { HOST } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { createRoomAsHost, useSimpleDiceRenderer } from '../support/flows'
import { mockRestApi } from '../support/restMock'

/**
 * 좁은 폭 강건성. `styles/global.css`가 `html`·`body`에 `min-width: 320px`을 박아 320px을
 * 지원 하한으로 선언했는데, 그 하한을 보는 검증이 없었다 — 가장 잘 깨지는 폭이 검증 밖이라
 * 한글이 어절 중간에서 끊기고 긴 라벨이 넘치는 것을 실기기에서야 발견했다.
 *
 * <b>스크린샷 대신 기하로 잡는다.</b> 스크린샷 비교는 폰트 렌더 차이로 흔들리고 무엇이
 * 틀렸는지 말해 주지 않는다. 가로 넘침은 숫자로 판정되고, 넘친 요소의 이름까지 짚을 수 있다.
 *
 * `mobile-320` 프로젝트에서만 의미가 있으므로 그 폭이 아니면 건너뛴다 — 같은 스펙을
 * 데스크톱에서 돌려도 통과하지만 아무것도 지켜 주지 않는다.
 */

/** 이 폭 이하에서만 검사한다(mobile-320 프로젝트). */
const NARROW_MAX_PX = 400

/** 서브픽셀 반올림 여유. 1px 미만 초과는 넘침이 아니다. */
const SUBPIXEL_SLACK = 1

test.beforeEach(({ page }) => {
  const width = page.viewportSize()?.width ?? 0
  test.skip(width > NARROW_MAX_PX, `좁은 폭 전용 스펙 (현재 ${width}px)`)
})

/**
 * 문서 전체가 가로로 넘치지 않아야 한다. 랜딩은 `overflow-hidden`이라 넘침이 잘려
 * 보이지 않을 수 있으므로, 문서 폭과 함께 <b>개별 요소의 오른쪽 끝</b>도 본다.
 */
async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const report = await page.evaluate(
    ({ slack }) => {
      const viewport = window.innerWidth

      // 흐르는 티커·복제 트랙처럼 잘려 나가도록 의도된 것은 조상이 감춘다. 판정 대상은
      // "감춰 주는 조상이 없는데도 뷰포트를 넘는" 요소뿐이다.
      const clippedByAncestor = (element: HTMLElement) => {
        for (let node = element.parentElement; node; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') return true
        }
        return false
      }

      const escapes = (element: HTMLElement) => {
        const style = getComputedStyle(element)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        if (clippedByAncestor(element)) return false

        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        return rect.right > viewport + slack || rect.left < -slack
      }

      const describe = (element: HTMLElement) => ({
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '')
          .trim()
          .slice(0, 48),
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName.toLowerCase(),
      })

      const overflowing = [...document.body.querySelectorAll<HTMLElement>('*')]
        .filter(escapes)
        .slice(0, 8)
        .map(describe)

      return { documentWidth: document.documentElement.scrollWidth, overflowing, viewport }
    },
    { slack: SUBPIXEL_SLACK },
  )

  expect(report.overflowing, `${screen}: 뷰포트를 넘는 요소`).toEqual([])
  expect(
    report.documentWidth,
    `${screen}: 문서가 ${report.viewport}px보다 넓다 (가로 스크롤)`,
  ).toBeLessThanOrEqual(report.viewport + SUBPIXEL_SLACK)
}

/**
 * 한글이 어절 중간에서 끊기지 않아야 한다. `word-break: keep-all`이 걸리지 않은 한글은
 * 「참가자를」이 「참가 / 자를」로 갈라져 읽는 리듬이 깨진다.
 *
 * `global.css`가 `:root`에 `keep-all` + `overflow-wrap: break-word`를 이미 걸어 뒀다 —
 * 이 단정은 새 규칙을 요구하는 게 아니라 <b>그 전역 규칙이 실제 텍스트까지 닿는지</b>를
 * 지킨다. 어느 화면이 `break-normal`이나 `break-all`로 덮으면 여기서 걸린다.
 *
 * 계산된 스타일로 본다 — 실제 줄바꿈 위치를 세는 것보다 규칙이 걸렸는지를 보는 편이
 * 폰트·폭 변화에 흔들리지 않는다.
 */
async function expectKoreanWordBreakProtected(page: Page, screen: string) {
  const result = await page.evaluate(() => {
    const hangul = /[가-힣]/
    const offenders: string[] = []
    let examined = 0

    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      // 자기 자신이 직접 가진 텍스트만 본다 — 부모가 자식 텍스트까지 세면 전부 걸린다.
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim()
      // 어절이 하나뿐이면 끊길 자리도 없다.
      if (!hangul.test(ownText) || !ownText.includes(' ')) continue

      const style = getComputedStyle(element)
      // nowrap은 아예 줄을 바꾸지 않으므로 어절이 깨질 일이 없다(넘침은 위 검사가 잡는다).
      if (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre') continue

      examined += 1
      if (style.wordBreak === 'keep-all') continue
      offenders.push(ownText.slice(0, 40))
    }

    return { examined, offenders: [...new Set(offenders)].slice(0, 8) }
  })

  // 검사 대상이 0개면 이 단정은 아무것도 지켜 주지 않는다 — 통과가 곧 안전이라고
  // 오해하지 않도록, 볼 것이 없다는 사실 자체를 실패로 만든다.
  expect(
    result.examined,
    `${screen}: 줄바꿈될 수 있는 한글 문장을 하나도 찾지 못했다`,
  ).toBeGreaterThan(0)
  expect(result.offenders, `${screen}: word-break: keep-all이 걸리지 않은 한글 문장`).toEqual([])
}

/**
 * 실제로 그려진 줄 수. 요소가 자식 없이 텍스트만 가질 때만 정확하다 — `Range`는 자식
 * 요소의 사각형까지 세므로, 자식이 있으면 줄이 아닌 것을 줄로 센다.
 */
async function renderedLineCount(page: Page, text: string) {
  return page.evaluate((needle) => {
    const target = [...document.querySelectorAll<HTMLElement>('h1, h2, p, span')].find(
      (element) => element.children.length === 0 && (element.textContent ?? '').includes(needle),
    )
    if (!target) return -1
    const range = document.createRange()
    range.selectNodeContents(target)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  }, text)
}

/**
 * 짧은 라벨이 <b>제 칸 안에 한 줄로</b> 들어가는지. 줄 수와 담김을 함께 봐야 한다 —
 * `nowrap`만 걸면 줄 수는 1이 되지만 라벨이 칸을 삐져나와 옆 요소와 겹치고, 그 겹침은
 * 뷰포트 안에서 일어나므로 가로 넘침 검사에 걸리지 않는다.
 */
async function labelFit(page: Page, text: string) {
  return page.evaluate((needle) => {
    const target = [...document.querySelectorAll<HTMLElement>('span, p')].find(
      (element) =>
        (element.textContent ?? '').trim().endsWith(needle) && element.children.length <= 1,
    )
    if (!target?.parentElement) return { fits: false, lines: -1 }

    const own = target.getBoundingClientRect()
    const column = target.parentElement.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(target)

    return {
      // 스크롤 폭이 보이는 폭보다 크면 내용이 칸을 넘겼다는 뜻이다(nowrap이면 여기서 잡힌다).
      fits: target.scrollWidth <= target.clientWidth + 1 && own.right <= column.right + 1,
      lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
    }
  }, text)
}

test('keeps the landing page within 320px and protects Korean word breaks', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()

  await expectNoHorizontalOverflow(page, '랜딩')
  await expectKoreanWordBreakProtected(page, '랜딩')

  // 히어로 태그라인이 320px에서 4줄(120px)로 부풀었던 자리다. 원인은 줄바꿈 속성이 아니라
  // 옆에 선 초대 코드 칩(shrink-0 116px)이 태그라인을 152px로 압착한 것이었다 —
  // `max-tiny:`로 쌓아 280px을 받게 고쳤다. 다시 옆으로 붙이면 이 단정이 걸린다.
  expect(
    await renderedLineCount(page, '링크 하나로 모이면'),
    '랜딩 태그라인이 320px에서 두 줄을 넘었다 (옆 요소에 압착됐는지 확인)',
  ).toBeLessThanOrEqual(2)
})

test('keeps the nickname screen within 320px', async ({ page }) => {
  await page.goto('/join?code=ABCD')

  await expect(page.getByRole('textbox', { name: '닉네임' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '닉네임')
  await expectKoreanWordBreakProtected(page, '닉네임')
})

test('keeps the invalid invite screen within 320px', async ({ page }) => {
  await page.goto('/join?code=BAD')

  await expect(page.getByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '초대 오류')
  await expectKoreanWordBreakProtected(page, '초대 오류')
})

test('keeps the lobby within 320px', async ({ page }) => {
  await mockRestApi(page)
  await startFakeGameServer(page, { you: HOST.id })
  await createRoomAsHost(page)

  await expectNoHorizontalOverflow(page, '대기실')
  await expectKoreanWordBreakProtected(page, '대기실')
})

/**
 * 게임 화면은 좁은 폭에서 가장 붐빈다 — 헤더(나가기·턴·타이머·소리·도움말)가 320px에서
 * 고정 폭으로만 276px을 먹고, 턴 표시 칸은 남은 56px을 받는다.
 *
 * <b>`/tutorial`로 들어간다.</b> 연습 모드가 같은 `GamePlay`·`GamePlayHeader`를 쓰므로
 * 실시간 방 없이 같은 레이아웃을 볼 수 있다 — `startHostedGame`은 mock 흐름에서 호스트가
 * 되지 않아(`waitingSnapshot`에 `hostId`가 없다) 쓸 수 없고, 같은 이유로
 * `game-flow.spec.ts` 4건이 이 티켓 전부터 실패하고 있다(S15P11A406-167).
 *
 * 실전 전용 요소(연결 배너 · 참가자 점수시트 · 리액션 독)는 이 경로로 덮이지 않는다.
 * 그 부분은 167 이후에 실시간 흐름으로 따로 확인해야 한다.
 */
test('keeps the practice game screen within 320px', async ({ page }) => {
  await useSimpleDiceRenderer(page)
  await page.goto('/tutorial')

  await expect(page.getByRole('timer', { name: '남은 시간' })).toBeVisible()

  await expectNoHorizontalOverflow(page, '연습 게임')
  await expectKoreanWordBreakProtected(page, '연습 게임')

  // 헤더의 라운드 라벨은 짧은 라벨이라 접히면 안 된다. 320px에서 「Round 01 / 12」(약 110px)가
  // 56px 칸에서 두 줄이 됐다.
  //
  // 줄 수만 세면 부족하다 — `whitespace-nowrap`만 걸어도 줄 수는 1이 되고, 대신 라벨이 제
  // 칸을 삐져나와 옆 버튼과 겹친다. 뷰포트 안에는 있으니 넘침 검사에도 걸리지 않는다.
  // 그래서 **제 칸 안에 들어가는지**까지 본다.
  expect(await labelFit(page, '/ 12'), '헤더 라운드 라벨이 제 칸을 넘거나 접혔다').toEqual({
    fits: true,
    lines: 1,
  })
})
