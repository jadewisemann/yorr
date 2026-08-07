import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Dice } from '@/yacht/components/Dice'
import { RollResultCallout } from '@/yacht/components/RollResultCallout'
import type { DiceSet } from '@/yacht/domain/dice'
import type { SpecialHand } from '@/yacht/domain/specialHands'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'
import { createHandVoice, HAND_VOICE_SOURCE, type HandVoice } from '@/yacht/feedback/handVoice'

const CASES: { dice: DiceSet; hand: SpecialHand }[] = [
  { hand: 'yacht', dice: [5, 5, 5, 5, 5] },
  { hand: 'smallStraight', dice: [1, 2, 3, 4, 6] },
  { hand: 'largeStraight', dice: [2, 3, 4, 5, 6] },
  { hand: 'fourOfAKind', dice: [4, 4, 4, 4, 2] },
  { hand: 'fullHouse', dice: [3, 3, 3, 6, 6] },
]

const CALLOUT_MS: Record<SpecialHand, number> = {
  yacht: 2400,
  largeStraight: 1800,
  smallStraight: 1400,
  fullHouse: 1400,
  fourOfAKind: 1400,
}

export function HandVoiceLab() {
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

  useEffect(() => {
    if (shot) voiceRef.current?.play(shot.hand)
  }, [shot])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
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
