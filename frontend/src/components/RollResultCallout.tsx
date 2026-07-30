import { useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '@/cn'
import type { SpecialHand } from '@/domain/specialHands'
import { categoryLabel } from '@/yachtCategoryView'

interface RollResultCalloutProps {
  hand: SpecialHand
  onDone: () => void
}

interface EffectCalloutProps {
  text: string
  /** 1 = 팝, 2 = 팝(조금 더 오래), 3 = 팝 + 화면 플래시 + 버스트. */
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

/** 연출이 화려할수록 오래 보여준다. 다음 조작을 막지 않게 pointer-events는 항상 끈다. */
const durationMsByTier = { 1: 1400, 2: 1800, 3: 2400 } as const

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * 굴림이 끝나면 성립한 족보를 큰 글자로 알려주는 오버레이.
 * 디자인 레퍼런스(S15P11A406-105)의 "요트!!!" — 박스 없는 대형 골드 텍스트에
 * 등급만큼 느낌표를 붙인다. 부모에서 key로 굴림마다 리마운트해 연출을 처음부터 다시 돈다.
 */
export function RollResultCallout({ hand, onDone }: RollResultCalloutProps) {
  const tier = tierByHand[hand]
  return (
    <EffectCallout onDone={onDone} text={`${categoryLabel[hand]}${'!'.repeat(tier)}`} tier={tier} />
  )
}

/**
 * 족보 콜아웃의 연출을 임의 문구로 재사용하는 오버레이(내 차례 알림 등).
 * 부모에서 key로 리마운트해야 연출이 처음부터 다시 돈다.
 */
export function EffectCallout({ onDone, text, tier }: EffectCalloutProps) {
  // 부모(카운트다운)가 매초 리렌더하며 onDone을 새로 만든다. deps에 넣으면
  // 타임아웃이 계속 리셋돼 콜아웃이 닫히지 않으므로 ref로 최신 핸들러만 읽는다.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const timeout = setTimeout(() => onDoneRef.current(), durationMsByTier[tier])
    return () => clearTimeout(timeout)
  }, [tier])

  // 문구는 절대 줄바꿈하지 않는다 — 좁은 화면에서 폭을 넘치면 전체 폰트를 비율로 줄인다.
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const element = textRef.current
    const overlay = element?.closest('[role="status"]')
    if (!element || !(overlay instanceof HTMLElement)) return
    element.style.fontSize = ''
    const style = getComputedStyle(element)
    // 패딩은 폰트와 함께 줄지 않으므로, 비율은 순수 텍스트 폭 기준으로 잡아야 꼭 맞는다.
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const textWidth = element.scrollWidth - padding
    const available = overlay.clientWidth - padding
    if (available <= 0 || textWidth <= available) return
    element.style.fontSize = `${(Number.parseFloat(style.fontSize) * available) / textWidth}px`
  }, [text, tier])

  return (
    <div
      // 텍스트는 트레이 상단에 둔다 — 가운데에 얹으면 방금 굴린 주사위를 가린다.
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
            // 트레이 위에 바로 얹히므로 화이트 글로우로 배경과 분리한다.
            // 팝 keyframes가 글로우를 0에서 이 값까지 키운다 — 여기 정적 값은 motion-reduce용.
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
