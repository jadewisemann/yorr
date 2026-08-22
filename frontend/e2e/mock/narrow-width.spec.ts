import { expect, type Page, test } from '@playwright/test'
import { GUEST, HOST, player, scoreBoard, waitingSnapshot } from '../support/contract'
import { startFakeGameServer } from '../support/fakeGameServer'
import { createRoomAsHost, startHostedGame, useSimpleDiceRenderer } from '../support/flows'
import { mockRestApi } from '../support/restMock'

const NARROW_MAX_PX = 400

const SUBPIXEL_SLACK = 1

test.beforeEach(({ page }) => {
  const width = page.viewportSize()?.width ?? 0
  test.skip(width > NARROW_MAX_PX, `좁은 폭 전용 스펙 (현재 ${width}px)`)
})

async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const report = await page.evaluate(
    ({ slack }) => {
      const viewport = window.innerWidth

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

async function expectKoreanWordBreakProtected(page: Page, screen: string) {
  const result = await page.evaluate(() => {
    const hangul = /[가-힣]/
    const offenders: string[] = []
    let examined = 0

    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim()

      if (!hangul.test(ownText) || !ownText.includes(' ')) continue

      const style = getComputedStyle(element)

      if (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre') continue

      examined += 1
      if (style.wordBreak === 'keep-all') continue
      offenders.push(ownText.slice(0, 40))
    }

    return { examined, offenders: [...new Set(offenders)].slice(0, 8) }
  })

  expect(
    result.examined,
    `${screen}: 줄바꿈될 수 있는 한글 문장을 하나도 찾지 못했다`,
  ).toBeGreaterThan(0)
  expect(result.offenders, `${screen}: word-break: keep-all이 걸리지 않은 한글 문장`).toEqual([])
}

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

async function labelFit(page: Page, text: string) {
  return page.evaluate((needle) => {
    const target = [...document.querySelectorAll<HTMLElement>('span, p')].find(
      (element) =>
        (element.textContent ?? '').trim().endsWith(needle) &&
        element.children.length <= 1 &&
        element.getClientRects().length > 0,
    )
    if (!target?.parentElement) return { fits: false, lines: -1 }

    const own = target.getBoundingClientRect()
    const column = target.parentElement.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(target)

    return {
      fits: target.scrollWidth <= target.clientWidth + 1 && own.right <= column.right + 1,
      lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
    }
  }, text)
}

async function expectListShowsRows(page: Page, listLabel: string, minRows: number) {
  const measured = await page.evaluate(
    ({ label }) => {
      const list =
        document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
        document.querySelector<HTMLElement>(`[aria-label*="${label}"]`)
      const row = list?.firstElementChild
      if (!list || !row) return null
      return { listHeight: list.clientHeight, rowHeight: row.getBoundingClientRect().height }
    },
    { label: listLabel },
  )

  expect(measured, `${listLabel}: 목록이나 첫 행을 찾지 못했다`).not.toBeNull()
  const { listHeight, rowHeight } = measured ?? { listHeight: 0, rowHeight: 1 }
  expect(
    Math.floor(listHeight / rowHeight),
    `${listLabel}: 보이는 높이 ${Math.round(listHeight)}px에 ${Math.round(rowHeight)}px 행이 ` +
      `${minRows}줄 들어가지 않는다 (고정 요소가 높이를 다 먹었는지 확인)`,
  ).toBeGreaterThanOrEqual(minRows)
}

test('keeps the landing page within 320px and protects Korean word breaks', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '요트 다이스' })).toBeVisible()

  await expectNoHorizontalOverflow(page, '랜딩')
  await expectKoreanWordBreakProtected(page, '랜딩')

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

  await expectListShowsRows(page, '참가자', 1)
})

test('keeps the practice game screen within 320px', async ({ page }) => {
  await useSimpleDiceRenderer(page)
  await page.goto('/tutorial')

  await expect(page.getByRole('timer', { name: '남은 시간' })).toBeVisible()

  await expectNoHorizontalOverflow(page, '연습 게임')
  await expectKoreanWordBreakProtected(page, '연습 게임')

  expect(await labelFit(page, '/ 12'), '헤더 라운드 라벨이 제 칸을 넘거나 접혔다').toEqual({
    fits: true,
    lines: 1,
  })
})

test('keeps the live game screen within 320px', async ({ page }) => {
  await useSimpleDiceRenderer(page)
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)
  await page.getByRole('button', { name: /^굴리기/ }).waitFor()

  await page.getByRole('button', { name: '알겠어요' }).click()

  await expectNoHorizontalOverflow(page, '실전 게임')
  await expectKoreanWordBreakProtected(page, '실전 게임')

  const narrow = (page.viewportSize()?.width ?? 0) < 360
  expect(
    await labelFit(page, narrow ? '내 턴' : '내 턴이에요'),
    '헤더 턴 라벨이 제 칸을 넘거나 접혔다',
  ).toEqual({ fits: true, lines: 1 })

  for (const reaction of ['like', 'laugh', 'shock', 'clap', 'gg']) {
    server.send('reaction.broadcast', { playerId: GUEST.id, reaction })
  }

  const flyingRights = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('span[aria-hidden="true"] > span')].map(
        (element) => Math.round(element.getBoundingClientRect().right),
      ),
    )

  await expect
    .poll(async () => (await flyingRights()).length, { message: '떠오른 리액션을 찾지 못했다' })
    .toBeGreaterThan(0)
  const viewport = page.viewportSize()?.width ?? 0
  expect(
    (await flyingRights()).filter((right) => right > viewport + SUBPIXEL_SLACK),
    `떠오른 리액션이 뷰포트(${viewport}px) 오른쪽을 넘었다 (drift가 양수인지 확인)`,
  ).toEqual([])
})

test('keeps the result screen readable within 320px', async ({ page }) => {
  await useSimpleDiceRenderer(page)
  await mockRestApi(page)
  const server = await startFakeGameServer(page, {
    you: HOST.id,
    snapshot: waitingSnapshot([player(HOST), player(GUEST)]),
  })

  await createRoomAsHost(page, HOST.nickname)
  await startHostedGame(page, server)
  await page.getByRole('button', { name: /^굴리기/ }).waitFor()

  server.send('game.yacht_dice.game.over', {
    rankings: [
      { rank: 1, playerId: HOST.id, total: scoreBoard({ yacht: 50 }).total },
      { rank: 2, playerId: GUEST.id, total: 0 },
    ],
  })
  await expect(page.getByRole('heading', { level: 1, name: '1위' })).toBeVisible()

  await expectNoHorizontalOverflow(page, '결과')
  await expectKoreanWordBreakProtected(page, '결과')

  await expectListShowsRows(page, '최종 순위', 2)
})
