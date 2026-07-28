import { useEffect, useRef } from 'react'
import { cn } from '@/cn'
import type { SpecialHand } from '@/domain/specialHands'
import { categoryLabel } from '@/yachtCategoryView'

interface RollResultCalloutProps {
  hand: SpecialHand
  onDone: () => void
}

/** 1 = 팝만, 2 = 팝 + 확산 링, 3 = 팝 + 링 + 화면 플래시 + 버스트. */
const tierByHand: Record<SpecialHand, 1 | 2 | 3> = {
  fourOfAKind: 1,
  fullHouse: 1,
  smallStraight: 1,
  largeStraight: 2,
  yacht: 3,
}

/** 연출이 화려할수록 오래 보여준다. 다음 조작을 막지 않게 pointer-events는 항상 끈다. */
const durationMsByTier = { 1: 1400, 2: 1800, 3: 2400 } as const

const captionByHand: Record<SpecialHand, string> = {
  fourOfAKind: 'Nice Roll',
  fullHouse: 'Nice Roll',
  smallStraight: 'Nice Roll',
  largeStraight: 'Great Roll',
  yacht: 'Jackpot',
}

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * 굴림이 끝나면 성립한 족보를 큰 글자로 알려주는 오버레이.
 * 부모에서 key로 굴림마다 리마운트해 타이머·애니메이션을 처음부터 다시 돈다.
 */
export function RollResultCallout({ hand, onDone }: RollResultCalloutProps) {
  const tier = tierByHand[hand]

  // 부모(카운트다운)가 매초 리렌더하며 onDone을 새로 만든다. deps에 넣으면
  // 타임아웃이 계속 리셋돼 콜아웃이 닫히지 않으므로 ref로 최신 핸들러만 읽는다.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const timeout = setTimeout(() => onDoneRef.current(), durationMsByTier[tier])
    return () => clearTimeout(timeout)
  }, [tier])

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden"
      role="status"
    >
      {tier === 3 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-callout-flash bg-brand/25 motion-reduce:hidden"
        />
      )}
      <div className="relative grid place-items-center">
        {tier >= 2 && (
          <span
            aria-hidden="true"
            className="absolute inset-0 -m-5 animate-callout-ring border-4 border-brand motion-reduce:hidden"
          />
        )}
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
            'relative m-0 animate-callout-pop border-4 bg-canvas px-8 py-4 text-center shadow-raised motion-reduce:animate-none',
            tier === 3 ? 'border-brand' : 'border-content',
          )}
        >
          <span className="block text-[11px] font-bold tracking-[0.14em] text-brand uppercase">
            {captionByHand[hand]}
          </span>
          <span className="block text-4xl leading-tight font-bold text-content">
            {categoryLabel[hand]}
          </span>
        </p>
      </div>
    </div>
  )
}
