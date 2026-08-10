import { useLayoutEffect, useState } from 'react'
import type { GuideStep, Lesson, SpotlightRect } from '@/yacht/components/TutorialGuide/types'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { YACHT_UPPER_CATEGORIES } from '@/yacht/domain/scoring'

export function unionRect(targets: Element[]): SpotlightRect | null {
  if (targets.length === 0) return null
  const boxes = targets.map((target) => target.getBoundingClientRect())
  const top = Math.min(...boxes.map((box) => box.top))
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.right))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  return { top, left, width: right - left, height: bottom - top }
}

export function useSpotlight(selector: string | null): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const target = document.querySelector(selector)
    const scope = target?.closest('[data-tutorial="sheet"]') ?? document
    const targets = target ? [...scope.querySelectorAll(selector)] : []
    const measure = () => setRect(unionRect(targets))
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('transitionend', measure, true)
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
    case 'record':
      return `[data-tutorial-category="${TUTORIAL_RECORD_CATEGORY}"]`
    default:
      return null
  }
}

export const TUTORIAL_RECORD_CATEGORY: YachtCategory = 'fourOfAKind'

const UPPER_CATEGORIES_SELECTOR = YACHT_UPPER_CATEGORIES.map(
  (category) => `[data-tutorial-category="${category}"]`,
).join(',')

export function dimsAroundHole(step: GuideStep) {
  return step !== 'record' && step !== 'categories'
}
