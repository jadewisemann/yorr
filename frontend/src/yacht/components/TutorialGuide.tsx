import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Backdrop } from '@/yacht/components/TutorialGuide/Backdrop'
import { Card, GuideTextButton } from '@/yacht/components/TutorialGuide/GuideCard'
import { lessonFor } from '@/yacht/components/TutorialGuide/lessons'
import { HandScore } from '@/yacht/components/TutorialGuide/openHandLessons'
import { nextOf, stepFromPlay } from '@/yacht/components/TutorialGuide/steps'
import type { GuideStep, Lesson } from '@/yacht/components/TutorialGuide/types'
import type { TurnProgress } from '@/yacht/model/gamePlayView'
import { dimsAroundHole, spotlightFor, useSpotlight } from '@/yacht/model/useSpotlight'

interface TutorialGuideProps extends TurnProgress {
  onClose: () => void
}

interface LessonActionsProps {
  lesson: Lesson
  onAdvance: () => void
  onClose: () => void
  onStep: (step: GuideStep) => void
}

/**
 * 카드 아래 버튼 줄. 언제든 그만둘 수 있고, 버튼으로 넘어가는 단계면 다음(과 갈림길) 버튼을,
 * 화면을 눌러야 넘어가는 단계면 안내 문구를 띄운다.
 */
function LessonActions({ lesson, onAdvance, onClose, onStep }: LessonActionsProps) {
  const { secondary } = lesson
  return (
    <div className="mt-0.5 flex items-center justify-between gap-3">
      <GuideTextButton label="연습 그만두기" onClick={onClose} />
      {lesson.action ? (
        <span className="flex items-center gap-2">
          {secondary && (
            <Button onClick={() => onStep(secondary.step)} size="sm" variant="ghost">
              {secondary.label}
            </Button>
          )}
          <Button onClick={onAdvance} size="sm" variant="secondary">
            {lesson.action}
          </Button>
        </span>
      ) : (
        <span className="text-xs font-semibold text-brand-strong">표시된 곳을 눌러 보세요</span>
      )}
    </div>
  )
}

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
        <LessonActions lesson={lesson} onAdvance={advance} onClose={onClose} onStep={setStep} />
      </Card>
    </div>
  )
}
