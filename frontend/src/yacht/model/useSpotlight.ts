import { useLayoutEffect, useState } from 'react'
import type { GuideStep, Lesson, SpotlightRect } from '@/yacht/components/TutorialGuide/types'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { YACHT_UPPER_CATEGORIES } from '@/yacht/domain/scoring'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/** 여러 칸을 감싸는 하나의 사각형. 한 칸만 있으면 그 칸 그대로다. */
export function unionRect(targets: Element[]): SpotlightRect | null {
  if (targets.length === 0) return null
  const boxes = targets.map((target) => target.getBoundingClientRect())
  const top = Math.min(...boxes.map((box) => box.top))
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.right))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  return { top, left, width: right - left, height: bottom - top }
}

/**
 * 강조할 요소의 화면 좌표. 트레이가 리사이즈되거나 화면이 돌아가도 링이 따라가야 하므로
 * 한 번 재고 마는 대신 관찰한다. 단계가 바뀌면 selector가 바뀌어 저절로 다시 잰다.
 */
export function useSpotlight(selector: string | null): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const target = document.querySelector(selector)
    /*
     * selector가 여러 칸을 가리키면(보너스 = 위 여섯 칸) 그것들을 감싸는 한 덩어리를 짚는다.
     *
     * 단, 좁은 화면에서는 같은 족보가 퀵 칩 줄과 점수표에 둘 다 있다. 첫 매치가 선 표면
     * 안에서만 모은다 — 두 표면을 함께 감싸면 구멍이 화면 절반을 먹는다.
     */
    const scope = target?.closest('[data-tutorial="sheet"]') ?? document
    const targets = target ? [...scope.querySelectorAll(selector)] : []
    const measure = () => setRect(unionRect(targets))
    /*
     * 강조할 것이 화면 밖이면 먼저 끌어온다. 족보를 한 칸씩 짚는 동안 타깃은 가로로 스크롤되는
     * 퀵 칩 줄(좁은 화면)이나 세로로 스크롤되는 점수표(넓은 화면) 안에 있어서, 뒤쪽 칸은
     * 그냥 두면 구멍이 화면 밖에 그려진다.
     * nearest·center: 세로는 필요한 만큼만 움직이고(페이지 자체는 h-svh라 스크롤되지 않는다),
     * 가로는 가운데로 가져와 다음 칸으로 넘어갈 때 조금씩 밀리지 않는다.
     * jsdom에는 scrollIntoView가 없다 — 아래 ResizeObserver와 같은 이유로 있으면 쓴다.
     */
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
    measure()
    window.addEventListener('resize', measure)
    /*
     * transform 전환이 끝나면 다시 잰다. 마지막 굴림 뒤 기록 패널이 자동으로 열리며 위로
     * 미끄러지는데, ResizeObserver는 조상의 transform 이동을 못 본다 — 구멍이 열리기 전
     * 자리에 남아 정작 누르라는 포커 칩을 차단막이 덮고 있었다(3차 QA).
     */
    window.addEventListener('transitionend', measure, true)
    // ResizeObserver가 없는 환경(jsdom 등)에서도 안내는 그대로 떠야 한다 — 구멍이 따라다니지
    // 않을 뿐이고, resize 이벤트가 큰 변화는 이미 잡는다.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (target && observer) observer.observe(target)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('transitionend', measure, true)
      observer?.disconnect()
    }
  }, [selector])

  return rect
}

export function spotlightFor(step: GuideStep, hand: Lesson['hand']): string | null {
  // 보너스는 기록하는 칸이 아니라 **위 여섯 칸이 모여 만드는 것**이다 — 그 여섯을 함께 짚는다.
  if (hand) {
    return hand.category ? `[data-tutorial-category="${hand.category}"]` : UPPER_CATEGORIES_SELECTOR
  }
  switch (step) {
    case 'roll':
    case 'reroll':
    case 'lastRoll':
      return '[data-tutorial="roll"]'
    case 'keep':
    case 'keepAgain':
      return '[data-tutorial="tray"]'
    case 'motion':
      return '[data-tutorial="motion"]'
    // 기록은 "아무거나"가 아니라 이번 대본이 만들어 준 포커를 콕 집어 누르게 한다.
    case 'record':
      return `[data-tutorial-category="${TUTORIAL_RECORD_CATEGORY}"]`
    default:
      return null
  }
}

/**
 * 연습에서 직접 기록해 보는 칸. 대본 마지막 굴림이 [6 6 6 6 2]이라 같은 눈 4개 =
 * 포커(26점)이고 식스(24점)보다 높다 — 이름 있는 족보를 만들어 본 경험이 남는다.
 */
export const TUTORIAL_RECORD_CATEGORY: YachtCategory = 'fourOfAKind'

/** 위 여섯 칸을 한 덩어리로 짚는 selector. 보너스가 가리키는 대상이다. */
const UPPER_CATEGORIES_SELECTOR = YACHT_UPPER_CATEGORIES.map(
  (category) => `[data-tutorial-category="${category}"]`,
).join(',')

/**
 * 구멍 주변을 어둡게 덮을지.
 *
 * 주사위를 다루는 단계는 덮는다 — 트레이 하나만 밝으면 "여기"가 설명 없이 읽힌다.
 *
 * 점수표를 다루는 단계(기록 · 족보 둘러보기)는 덮지 않는다. 어둠이 표를 통째로 지우면
 * 어느 칸에 적는 중인지, 적고 나서 무엇이 바뀌었는지를 볼 수 없다 — 정작 봐야 할 순간에
 * 화면을 가리는 셈이다. 덮지 않아도 구멍 밖 차단막은 그대로라 엉뚱한 곳은 눌리지 않는다.
 */
export function dimsAroundHole(step: GuideStep) {
  return step !== 'record' && step !== 'categories'
}
