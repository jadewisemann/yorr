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
  /** 주사위가 날아가는 중인지. 이 동안에는 단계가 움직이지 않는다(stepFromPlay 주석 참고). */
  rolling: boolean
  /** 이번 턴에 주사위가 깔려 있는지(첫 굴림 완료). */
  rolled: boolean
  /** 지금 킵되어 있는 주사위의 눈. 무엇을 킵했는지까지 보고 다음으로 넘긴다. */
  keptValues: number[]
  /** 이번 턴 기록까지 끝났는지. */
  submitted: boolean
  /** 서버가 확정한 굴림 횟수. */
  rollCount: number
  /** 지금 주사위로 각 족보가 몇 점인지. 족보 설명을 실제 눈과 함께 보여준다. */
  candidates: CategoryScores
  /** 모션 센서를 켤 수 있는 기기인지. 아니면 마지막 굴림을 흔들기 대신 버튼으로 하게 한다. */
  motionNoticeVisible: boolean
  /** 넓은 레이아웃인지. 점수표가 우측 패널이냐 아래 기록 패널이냐가 갈린다. */
  wide: boolean
  /** 연습을 끝내고 나간다. */
  onClose: () => void
}

/**
 * 굴림 → 선택을 두 번 되풀이하고, 마지막 굴림을 흔들기로 체험한 뒤 족보를 설명한다.
 *
 * 요트의 한 턴은 "굴리고 남길 것을 고른다"의 반복이다. 그 반복을 한 번만 보여주면 규칙이
 * 아니라 일회성 조작으로 읽혀서, 2굴림 뒤에도 고르는 단계(keepAgain)를 둔다 — 킵이 쌓이는
 * 것이 여기서 처음 눈에 보인다.
 *
 * 족보는 손이 하는 일(굴림·선택)을 다 끝낸 뒤로 미룬다. 던지다 말고 읽고 다시 던지면
 * 흐름이 끊긴다.
 */
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

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */

/**
 * 연습 모드의 안내(S15P11A406-143). 완전 초심자가 대상이라 "읽고 알아서 하세요"로는 부족하다 —
 * 큰 카드로 한 번에 하나씩 말하고, **지금 눌러야 할 것 하나**에 강조 링을 씌운다.
 *
 * 눌러야 하는 단계에서는 화면을 덮지 않는다. 어둠을 깔면 "여기를 누르세요"라고 해놓고 그 손을
 * 막는다. 누를 곳이 없는 읽기 단계(인사 · 족보 설명 · 마무리)에서만 덮어 읽는 데 집중시킨다.
 *
 * 단계는 버튼이 아니라 실제 플레이(굴림 → 킵 → 기록)에 반응해 넘어간다. 직접 해봐야 배운다.
 * 순서는 손이 하는 일을 먼저 끝내고(굴림 세 번 · 킵) 머리가 하는 일(족보)로 넘어간다.
 */
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
  // 족보 설명은 한 장씩 넘긴다. 단계 안에서만 쓰는 위치라 step과 따로 둔다.
  const [handIndex, setHandIndex] = useState(0)

  /*
   * 6의 개수는 대본을 믿지 않고 화면(식스 후보 점수)에서 거꾸로 센다 — 사용자가 안내와 다르게
   * 킵해 대본과 어긋나는 순간 틀린 숫자를 우길 이유가 없다.
   */
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

  /** 버튼 하나가 세 가지를 한다: 연습 끝내기 · 족보 다음 칸 · 다음 단계. */
  const advance = () => {
    if (step === 'done') return onClose()
    if (lesson.hand && lesson.hand.index < lesson.hand.total - 1) {
      setHandIndex(lesson.hand.index + 1)
      return
    }
    setStep(nextOf(step, motionNoticeVisible))
  }

  return (
    // 래퍼는 클릭을 통과시킨다 — 여기서 막으면 강조해 놓은 버튼조차 눌리지 않는다.
    <div className="pointer-events-none fixed inset-0 z-modal" role="presentation">
      {/* 주사위가 날아가는 동안에는 백드롭을 통째로 걷는다 — 굴러가는 주사위가 이 연습의
          볼거리인데 딤이 덮으면 안 보인다. 조작은 게임 자체가 잠그고 있어 막을 것도 없다. */}
      {!rolling && <Backdrop dim={dimsAroundHole(step)} spotlight={spotlight} />}
      {/* 족보를 설명하는 장은 짚은 자리 옆에 말풍선으로 붙는다 — 보너스도 여섯 칸 덩어리 옆이다. */}
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
            // 직접 눌러야 넘어가는 단계 — 어디를 누를지는 강조 링이 말한다.
            <span className="text-xs font-semibold text-brand-strong">표시된 곳을 눌러 보세요</span>
          )}
        </div>
      </Card>
    </div>
  )
}
