import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { cn } from '@/shared/cn'
import type { SpecialHand } from '@/yacht/domain/specialHands'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'

interface RollResultCalloutProps {
  hand: SpecialHand
  onDone: () => void
}

interface EffectCalloutProps {
  text: string
  tier: 1 | 2 | 3
  onDone: () => void
}

const tierByHand: Record<SpecialHand, 1 | 2 | 3> = {
  fourOfAKind: 1,
  fullHouse: 1,
  smallStraight: 1,
  largeStraight: 2,
  yacht: 3,
}

const durationMsByTier = { 1: 1400, 2: 1800, 3: 2400 } as const

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

export function RollResultCallout({ hand, onDone }: RollResultCalloutProps) {
  const tier = tierByHand[hand]
  return (
    <EffectCallout onDone={onDone} text={`${categoryLabel[hand]}${'!'.repeat(tier)}`} tier={tier} />
  )
}

export function EffectCallout({ onDone, text, tier }: EffectCalloutProps) {
  const done = useEffectEvent(onDone)

  useEffect(() => {
    const timeout = setTimeout(() => done(), durationMsByTier[tier])
    return () => clearTimeout(timeout)
  }, [tier])

  const textRef = useRef<HTMLParagraphElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 값을 직접 읽진 않지만 text·tier가 바뀌면 렌더된 폭이 달라져 다시 재야 한다
  useLayoutEffect(() => {
    const element = textRef.current
    const overlay = element?.closest('[role="status"]')
    if (!element || !(overlay instanceof HTMLElement)) return
    element.style.fontSize = ''
    const style = getComputedStyle(element)
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const textWidth = element.scrollWidth - padding
    const available = overlay.clientWidth - padding
    if (available <= 0 || textWidth <= available) return
    element.style.fontSize = `${(Number.parseFloat(style.fontSize) * available) / textWidth}px`
  }, [text, tier])

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 grid items-start justify-items-center overflow-hidden pt-10"
      role="status"
    >
      {tier === 3 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-callout-flash bg-brand/25 motion-reduce:hidden"
        />
      )}
      <div className="relative grid place-items-center">
        {tier === 3 &&
          BURST_ANGLES.map((angle) => (
            <span
              aria-hidden="true"
              className="absolute h-7 w-1.5 animate-callout-burst bg-brand motion-reduce:hidden"
              key={angle}
              style={{ '--burst-angle': `${angle}deg` } as React.CSSProperties}
            />
          ))}
        <p
          className={cn(
            'relative m-0 animate-callout-pop px-3 text-center leading-none font-bold whitespace-nowrap text-brand-strong motion-reduce:animate-none',
            '[text-shadow:var(--ds-callout-glow)]',
            tier === 3 ? 'text-[clamp(4rem,16vw,7.5rem)]' : 'text-[clamp(3rem,12vw,5.5rem)]',
          )}
          ref={textRef}
        >
          {text}
        </p>
      </div>
    </div>
  )
}
