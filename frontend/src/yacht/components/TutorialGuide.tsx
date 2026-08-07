import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Backdrop } from '@/yacht/components/TutorialGuide/Backdrop'
import { Card, GuideTextButton } from '@/yacht/components/TutorialGuide/GuideCard'
import { lessonFor } from '@/yacht/components/TutorialGuide/lessons'
import { HandScore } from '@/yacht/components/TutorialGuide/openHandLessons'
import { nextOf, stepFromPlay } from '@/yacht/components/TutorialGuide/steps'
import type { CategoryScores } from '@/yacht/domain/scoring'
import { dimsAroundHole, spotlightFor, useSpotlight } from '@/yacht/model/useSpotlight'

interface TutorialGuideProps {
  rolling: boolean
  rolled: boolean
  keptValues: number[]
  submitted: boolean
  rollCount: number
  candidates: CategoryScores
  motionNoticeVisible: boolean
  wide: boolean
  onClose: () => void
}

type GuideStep =
  | 'greet'
  | 'roll'
  | 'keep'
  | 'reroll'
  | 'keepAgain'
  | 'askLastRoll'
  | 'motion'
  | 'lastRoll'
  | 'record'
  | 'categories'
  | 'done'

export function TutorialGuide({
  candidates,
  keptValues,
  motionNoticeVisible,
  onClose,
  rolled,
  rollCount,
  rolling,
  submitted,
  wide,
}: TutorialGuideProps) {
  const [step, setStep] = useState<GuideStep>('greet')
  const [handIndex, setHandIndex] = useState(0)

  const sixesScore = candidates.sixes ?? 0
  const sixesOnTray = Math.round(sixesScore / 6)
  const keptSixes = keptValues.filter((value) => value === 6).length
  const keptOther = keptValues.filter((value) => value !== 6).length

  useEffect(() => {
    const next = stepFromPlay(step, {
      keptSixes,
      motionNoticeVisible,
      rolled,
      rollCount,
      rolling,
      sixesOnTray,
      submitted,
    })
    if (next) setStep(next)
  }, [keptSixes, motionNoticeVisible, rolled, rollCount, rolling, sixesOnTray, step, submitted])

  const lesson = lessonFor(step, {
    candidates,
    handIndex,
    keptOther,
    keptSixes,
    motionNoticeVisible,
    sixes: sixesOnTray,
    sixesScore,
    wide,
  })
  const spotlight = useSpotlight(spotlightFor(step, lesson.hand))

  const advance = () => {
    if (step === 'done') return onClose()
    if (lesson.hand && lesson.hand.index < lesson.hand.total - 1) {
      setHandIndex(lesson.hand.index + 1)
      return
    }
    setStep(nextOf(step, motionNoticeVisible))
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-modal" role="presentation">
      {!rolling && <Backdrop dim={dimsAroundHole(step)} spotlight={spotlight} />}
      <Card anchor={lesson.hand ? spotlight : null} spotlight={spotlight}>
        {lesson.hand && (
          <p className="m-0 text-2xs font-bold tracking-[0.1em] text-content-faint uppercase">
            남은 족보 둘러보기 · {lesson.hand.index + 1} / {lesson.hand.total}
          </p>
        )}
        <h2 className="m-0 text-base leading-tight font-bold text-content">{lesson.title}</h2>
        <p
          aria-live="polite"
          className="m-0 text-sm leading-relaxed text-content-muted"
          role="status"
        >
          {lesson.body}
        </p>
        {lesson.hand?.score !== undefined && <HandScore score={lesson.hand.score} />}
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <GuideTextButton label="연습 그만두기" onClick={onClose} />
          {lesson.action ? (
            <span className="flex items-center gap-2">
              {lesson.secondary && (
                <Button
                  onClick={() => setStep(lesson.secondary?.step ?? step)}
                  size="sm"
                  variant="ghost"
                >
                  {lesson.secondary.label}
                </Button>
              )}
              <Button onClick={advance} size="sm" variant="secondary">
                {lesson.action}
              </Button>
            </span>
          ) : (
            <span className="text-xs font-semibold text-brand-strong">표시된 곳을 눌러 보세요</span>
          )}
        </div>
      </Card>
    </div>
  )
}
