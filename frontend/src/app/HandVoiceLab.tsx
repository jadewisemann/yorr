import { useEffect, useRef, useState } from 'react'
import { Dice } from '@/components/Dice'
import { RollResultCallout } from '@/components/RollResultCallout'
import type { DiceSet } from '@/domain/dice'
import type { SpecialHand } from '@/domain/specialHands'
import { createHandVoice, HAND_VOICE_SOURCE, type HandVoice } from '@/feedback/handVoice'
import { Button } from '@/shared/components/Button'
import { categoryLabel } from '@/yachtCategoryView'

/**
 * 숫자키 1~5에 붙는 족보. 주사위는 `detectSpecialHand`가 같은 족보를 고르도록 골랐다 —
 * 화면의 주사위와 콜아웃이 어긋나지 않게.
 */
const CASES: { dice: DiceSet; hand: SpecialHand }[] = [
  { hand: 'yacht', dice: [5, 5, 5, 5, 5] },
  { hand: 'smallStraight', dice: [1, 2, 3, 4, 6] },
  { hand: 'largeStraight', dice: [2, 3, 4, 5, 6] },
  { hand: 'fourOfAKind', dice: [4, 4, 4, 4, 2] },
  { hand: 'fullHouse', dice: [3, 3, 3, 6, 6] },
]

/** 콜아웃이 화면에 떠 있는 시간(`RollResultCallout`의 tier별 값). 목소리 길이와 비교할 기준. */
const CALLOUT_MS: Record<SpecialHand, number> = {
  yacht: 2400,
  largeStraight: 1800,
  smallStraight: 1400,
  fullHouse: 1400,
  fourOfAKind: 1400,
}

/**
 * 직접 녹음한 족보 콜아웃 음성을 게임 없이 확인하는 개발 전용 화면(S15P11A406-138).
 *
 * 실제 게임에서 이 연출을 보려면 방을 만들고 그 족보가 나올 때까지 굴려야 한다. 대신 여기서
 * 숫자키 1~5로 같은 컴포넌트(`RollResultCallout`)와 같은 재생기(`createHandVoice`)를 그대로
 * 띄운다 — 목소리가 텍스트보다 먼저 끝나는지, 다섯 개의 크기가 고른지 귀로 확인하는 용도다.
 */
export function HandVoiceLab() {
  // id는 콜아웃을 리마운트하는 key다 — 같은 족보를 연달아 눌러도 연출이 처음부터 다시 돈다.
  const [shot, setShot] = useState<{ dice: DiceSet; hand: SpecialHand; id: number } | null>(null)
  const voiceRef = useRef<HandVoice | null>(null)
  const [durations, setDurations] = useState<Partial<Record<SpecialHand, number>>>({})

  useEffect(() => {
    const voice = createHandVoice()
    voiceRef.current = voice
    return () => {
      voice.dispose()
      voiceRef.current = null
    }
  }, [])

  // 게임과 같은 순서로 — 콜아웃이 마운트되는 시점에 재생을 건다(GamePlay의 rollHighlight 효과).
  useEffect(() => {
    if (shot) voiceRef.current?.play(shot.hand)
  }, [shot])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      // 카탈로그에는 입력 필드도 있다 — 거기 타이핑하는 숫자로 소리가 나면 안 된다.
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input, textarea, select')) return
      const shown = CASES[Number(event.key) - 1]
      if (!shown) return
      event.preventDefault()
      setShot({ ...shown, id: Date.now() })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 목소리 길이를 읽어 표에 채운다. 콜아웃 표시 시간을 넘기면 빨갛게 보여준다.
  useEffect(() => {
    const probes = CASES.map(({ hand }) => {
      const probe = new Audio(HAND_VOICE_SOURCE[hand])
      probe.addEventListener('loadedmetadata', () => {
        setDurations((previous) => ({ ...previous, [hand]: Math.round(1000 * probe.duration) }))
      })
      return probe
    })
    return () => {
      for (const probe of probes) probe.src = ''
    }
  }, [])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {CASES.map((shown, index) => (
          <Button key={shown.hand} onClick={() => setShot({ ...shown, id: Date.now() })} size="sm">
            {index + 1} {categoryLabel[shown.hand]}
          </Button>
        ))}
      </div>

      <div className="relative grid min-h-64 place-items-center gap-4 rounded-panel bg-surface-sunken p-6">
        {shot ? (
          <>
            <div className="flex flex-wrap justify-center gap-2 self-end">
              {shot.dice.map((value, index) => (
                // 같은 눈이 여러 개라 값만으로는 key가 겹친다 — 자리 인덱스로 고정한다.
                // biome-ignore lint/suspicious/noArrayIndexKey: 주사위는 자리가 곧 정체성이다
                <Dice key={index} value={value} />
              ))}
            </div>
            <RollResultCallout hand={shot.hand} key={shot.id} onDone={() => setShot(null)} />
          </>
        ) : (
          <p className="text-sm text-content-muted">
            숫자키 <b>1~5</b> 또는 위 버튼으로 족보 콜아웃을 띄웁니다.
          </p>
        )}
      </div>

      <table className="w-full text-left text-sm">
        <thead className="text-content-muted">
          <tr>
            <th className="py-1 font-normal">키</th>
            <th className="py-1 font-normal">족보</th>
            <th className="py-1 font-normal">목소리</th>
            <th className="py-1 font-normal">콜아웃 표시</th>
          </tr>
        </thead>
        <tbody>
          {CASES.map(({ hand }, index) => {
            const voiceMs = durations[hand]
            const over = voiceMs !== undefined && voiceMs > CALLOUT_MS[hand]
            return (
              <tr className="border-t border-border" key={hand}>
                <td className="py-1 font-mono">{index + 1}</td>
                <td className="py-1">{categoryLabel[hand]}</td>
                <td className={over ? 'py-1 font-bold text-danger' : 'py-1'}>
                  {voiceMs === undefined ? '…' : `${voiceMs}ms`}
                </td>
                <td className="py-1 text-content-muted">{CALLOUT_MS[hand]}ms</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
