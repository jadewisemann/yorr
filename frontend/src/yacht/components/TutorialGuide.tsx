import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { MAX_ROLLS } from '@/yacht/domain/yachtGame'
import { categoryLabel } from '@/yacht/yachtCategoryView'

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
function spotlightFor(step: GuideStep, hand: Lesson['hand']): string | null {
  if (hand) return `[data-tutorial-category="${hand.category}"]`
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
const TUTORIAL_RECORD_CATEGORY: YachtCategory = 'fourOfAKind'

/**
 * 구멍 주변을 어둡게 덮을지.
 *
 * 주사위를 다루는 단계는 덮는다 — 트레이 하나만 밝으면 "여기"가 설명 없이 읽힌다.
 *
 * 점수표를 다루는 단계(기록 · 족보 둘러보기)는 덮지 않는다. 어둠이 표를 통째로 지우면
 * 어느 칸에 적는 중인지, 적고 나서 무엇이 바뀌었는지를 볼 수 없다 — 정작 봐야 할 순간에
 * 화면을 가리는 셈이다. 덮지 않아도 구멍 밖 차단막은 그대로라 엉뚱한 곳은 눌리지 않는다.
 */
function dimsAroundHole(step: GuideStep) {
  return step !== 'record' && step !== 'categories'
}

interface Lesson {
  title: string
  body: string
  /** 눌러야 다음으로 가는 단계에는 버튼을 두지 않는다 — 직접 해보는 것이 요점이다. */
  action?: string
  /** 두 갈래로 갈리는 단계의 다른 쪽 선택. 지금은 마지막 굴림을 어떻게 던질지 뿐이다. */
  secondary?: { label: string; step: GuideStep }
  /**
   * 족보 하나를 말풍선으로 설명하는 중. 설명하는 칸을 점수표에서 같이 강조하므로
   * 어느 칸인지(category)까지 들고 있어야 한다.
   */
  hand?: { category: YachtCategory; index: number; total: number; score: number | undefined }
}

/**
 * 족보 12칸을 **한 칸씩** 설명한다(S15P11A406-143). 예전에는 "설명은 ? 도움말에 있어요"로
 * 넘겼는데, 처음 온 사람에게 다른 곳을 찾아가라고 하면 대개 안 찾아간다 — 규칙을 알아야
 * 어디에 적을지 고를 수 있으니 마스코트가 직접 말한다.
 *
 * 위 여섯 칸도 묶지 않고 하나씩 짚는다. "고른 숫자만 더해요" 한 줄로 묶으면 규칙은 맞지만
 * 점수표에서 어느 칸이 무엇인지는 여전히 모른다 — 설명하는 칸을 화면에서 같이 강조하므로
 * 칸과 이름이 여기서 처음 연결된다.
 *
 * 이름은 categoryLabel에서 가져온다. 여기 따로 적으면 점수표와 다르게 부르는 순간이 온다.
 */
const HAND_LESSONS: ReadonlyArray<{ category: YachtCategory; rule: string }> = [
  { category: 'ones', rule: '1이 나온 개수만큼 1점씩 더해요. 세 개면 3점이에요.' },
  { category: 'twos', rule: '2가 나온 개수만큼 2점씩 더해요.' },
  { category: 'threes', rule: '3이 나온 개수만큼 3점씩 더해요.' },
  { category: 'fours', rule: '4가 나온 개수만큼 4점씩 더해요.' },
  { category: 'fives', rule: '5가 나온 개수만큼 5점씩 더해요.' },
  {
    category: 'sixes',
    rule: '6이 나온 개수만큼 6점씩 더해요. 위 여섯 칸 중 한 개당 점수가 가장 커요.',
  },
  { category: 'choice', rule: '모양을 안 따져요. 눈 다섯 개를 그냥 다 더해서 적어요.' },
  { category: 'fourOfAKind', rule: '같은 눈이 4개 모이면 다섯 개를 다 더해요.' },
  { category: 'fullHouse', rule: '같은 눈 3개와 다른 눈 2개가 함께 있으면 다 더해요.' },
  { category: 'smallStraight', rule: '이어지는 눈 4개(예: 2·3·4·5)면 무조건 15점이에요.' },
  { category: 'largeStraight', rule: '이어지는 눈 5개(예: 2·3·4·5·6)면 30점이에요.' },
  { category: 'yacht', rule: '다섯 개가 모두 같은 눈이면 50점 — 이 게임에서 가장 큰 점수예요.' },
]

/**
 * 아직 비어 있는 칸만 골라 설명한다. 방금 기록한 칸은 이미 무엇인지 배웠고, 점수표에서도
 * 사용됨으로 잠겨 강조할 자리가 없다.
 *
 * `candidates`에는 미기입 칸만 들어온다(calculateScoreCandidates가 사용한 칸을 뺀다).
 */
function openHandLessons(candidates: CategoryScores) {
  return HAND_LESSONS.filter((hand) => candidates[hand.category] !== undefined)
}

/**
 * 지금 주사위가 이 족보에 몇 점인지. 규칙만 적으면 외울 것이 늘 뿐이라 실제 점수를 붙인다 —
 * 0점은 "지금 주사위는 이 모양이 아니다"를 스스로 말해 준다.
 */
function HandScore({ score }: { score: number }) {
  return (
    <p
      className={cn(
        'm-0 text-[12.5px] font-semibold',
        score > 0 ? 'text-brand-strong' : 'text-content-faint',
      )}
    >
      {score > 0
        ? `지금 주사위로 적으면 ${score}점이에요.`
        : '지금 주사위는 이 모양이 아니라 0점이에요.'}
    </p>
  )
}

interface LessonContext {
  /** 지금 트레이에 6이 몇 개인지. 대본대로면 킵 단계에서 2개, 마지막에 4개다. */
  sixes: number
  /** 식스에 기록하면 몇 점인지. */
  sixesScore: number
  /** 그중 이미 킵한 6의 개수. 몇 개 남았는지 세어 준다. */
  keptSixes: number
  /** 6이 아닌데 킵해 둔 주사위 수. 있으면 풀라고 알려 준다. */
  keptOther: number
  /** 족보 설명 중 몇 번째 장을 보고 있는지. */
  handIndex: number
  /** 센서를 켤 수 있는 기기인지. 마지막 굴림을 어떻게 던질지 묻는 문구가 갈린다. */
  motionNoticeVisible: boolean
  /** 지금 주사위의 족보별 점수. 설명 옆에 실제 점수를 붙인다. */
  candidates: CategoryScores
  wide: boolean
}

/**
 * 굴림 뒤 "남길 것을 고르는" 단계의 문구. 첫 선택과 두 번째 선택이 같은 판단을 하므로 한
 * 곳에 둔다 — 두 번째는 이 고르기가 매 굴림마다 반복되는 규칙이라는 것을 덧붙인다.
 */
function keepLesson(ctx: LessonContext, again: boolean): Lesson {
  // 6이 아닌 걸 킵했으면 그것부터 알려 준다 — 초심자는 잘못 눌렀다는 것 자체를 모른다.
  if (ctx.keptOther > 0) {
    return {
      title: '6이 아닌 주사위를 킵했어요',
      body: again
        ? '한 번 더 탭하면 풀려요. 지금은 6만 모아 볼게요.'
        : '한 번 더 탭하면 킵이 풀려요. 지금은 6만 남겨 볼게요 — 같은 눈을 모을수록 점수가 커지거든요.',
    }
  }

  const left = ctx.sixes - ctx.keptSixes
  if (again) {
    return {
      title: `6이 ${ctx.sixes}개로 늘었어요`,
      body: `굴릴 때마다 남길 것을 다시 고르는 게 요트의 한 턴이에요. 새로 나온 6 ${left}개도 탭해서 킵해 보세요.`,
    }
  }
  return {
    title: ctx.keptSixes > 0 ? `좋아요, ${left}개 남았어요` : `6이 ${ctx.sixes}개 나왔어요`,
    body:
      ctx.keptSixes > 0
        ? `나머지 6 ${left}개도 탭해서 킵해 보세요. 6을 전부 모아 두고 나머지만 다시 굴릴 거예요.`
        : '같은 눈을 모으면 점수가 커져요. 6이 그려진 주사위를 모두 탭해서 킵해 보세요 — 킵한 주사위는 다시 굴려도 그대로 남아요.',
  }
}

/**
 * 기록 단계. 대본이 만들어 준 것은 "6이 네 개"인데, 그건 식스(24점)이면서 동시에
 * 포커(26점)다 — 더 높은 쪽이자 이름이 있는 쪽을 짚어 준다. 초심자가 "같은 눈 네 개는
 * 이름이 붙는다"를 처음 알게 되는 자리고, 점수 비교까지 한 문장에 들어간다.
 */
function recordLesson(ctx: LessonContext): Lesson {
  const pokerScore = ctx.candidates[TUTORIAL_RECORD_CATEGORY] ?? 0
  const where = ctx.wide ? '표시된 포커 행' : '아래 기록 패널에서 표시된 포커'
  return {
    title: `6이 ${ctx.sixes}개 — 이건 포커예요!`,
    body: `같은 눈이 4개 모이면 포커라고 불러요. 다섯 개를 다 더해 ${pokerScore}점이라, 식스에 적는 ${ctx.sixesScore}점보다 높아요. ${where}을 눌러 기록해 보세요.`,
  }
}

/** 족보 한 장. 마지막 장에서만 버튼 문구가 "다 봤어요"로 바뀐다. */
function handLesson(ctx: LessonContext): Lesson {
  const lessons = openHandLessons(ctx.candidates)
  const hand = lessons[ctx.handIndex]
  // 남은 칸이 없으면(모두 기록된 판) 설명할 것이 없다 — 마무리 문구로 대신한다.
  if (!hand) return doneLesson()

  return {
    title: categoryLabel[hand.category],
    body: hand.rule,
    hand: {
      category: hand.category,
      index: ctx.handIndex,
      total: lessons.length,
      score: ctx.candidates[hand.category],
    },
    action: ctx.handIndex >= lessons.length - 1 ? '다 봤어요' : '다음',
  }
}

function doneLesson(): Lesson {
  return {
    title: '한 턴을 다 하셨어요!',
    body: '이걸 12번 반복하면 게임이 끝나고, 총점이 가장 높은 사람이 이겨요. 이제 실전에서 만나요.',
    action: '연습 끝내기',
  }
}

/**
 * 단계별 문구. 주사위 눈이 대본으로 고정돼 있으므로 "6 두 개를 킵하세요"처럼 화면에 실제로
 * 있는 것을 짚어 말할 수 있다 — 무작위였다면 "마음에 드는 걸 고르세요"밖에 못 한다.
 * 그래도 개수는 화면에서 세어 넣는다. 사용자가 안내와 다르게 킵하면 대본과 어긋나는데,
 * 그때 굳이 틀린 숫자를 우길 이유가 없다.
 */
function lessonFor(step: GuideStep, ctx: LessonContext): Lesson {
  switch (step) {
    case 'greet':
      return {
        title: '요트 다이스가 처음이신가요?',
        body: '주사위 5개를 굴려 족보를 만드는 게임이에요. 여기서는 점수가 남지 않으니 마음껏 눌러 보세요. 한 턴을 처음부터 끝까지 같이 해볼게요.',
        action: '시작하기',
      }
    case 'roll':
      return {
        title: '먼저 주사위를 굴려요',
        body: ctx.wide
          ? '빨갛게 표시된 굴리기 버튼을 눌러 보세요. 스페이스바로도 굴릴 수 있어요. 한 턴에 3번까지예요.'
          : '빨갛게 표시된 굴리기 버튼을 눌러 보세요. 한 턴에 3번까지 굴릴 수 있어요.',
      }
    case 'keep':
      return keepLesson(ctx, false)
    case 'reroll':
      return {
        title: '나머지만 다시 굴려요',
        body: '킵한 6은 그대로 두고 나머지만 다시 굴러가요. 6이 더 붙는지 볼까요? 굴리기를 한 번 더 눌러 보세요.',
      }
    case 'keepAgain':
      return keepLesson(ctx, true)
    case 'askLastRoll':
      // 고르기를 끝낸 직후다. 여기서 곧바로 "센서를 켜라"로 넘어가면 방금 고른 결과를 볼
      // 틈도 없이 다음 지시가 떨어진다 — 한 번 묻고 사용자가 넘길 때 움직인다.
      return ctx.motionNoticeVisible
        ? {
            title: '이제 마지막 한 번이 남았어요',
            body: '한 턴에 세 번까지니까 이번이 마지막이에요. 어떻게 던져 볼까요?',
            action: '흔들어서 던지기',
            secondary: { label: '버튼으로 던지기', step: 'lastRoll' },
          }
        : {
            title: '이제 마지막 한 번이 남았어요',
            body: '한 턴에 세 번까지니까 이번이 마지막이에요. 굴리고 나면 다섯 개가 그대로 확정돼요.',
            action: '던져 볼게요',
          }
    case 'motion':
      return {
        title: '폰을 흔들어서 던져요',
        body: '표시된 "흔들기"를 눌러 센서를 켜고, 실제로 주사위를 굴리듯 폰을 흔들어 보세요.',
        action: '버튼으로 던질게요',
      }
    case 'lastRoll':
      return {
        title: '마지막 한 번 남았어요',
        body: '표시된 굴리기를 눌러 보세요. 굴리고 나면 다섯 개가 그대로 확정돼요.',
      }
    case 'categories':
      return handLesson(ctx)
    case 'record':
      return recordLesson(ctx)
    case 'done':
      return doneLesson()
  }
}

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
      <Backdrop dim={dimsAroundHole(step)} spotlight={spotlight} />
      <Card spotlight={spotlight}>
        {lesson.hand && (
          <p className="m-0 text-[11px] font-bold tracking-[0.1em] text-content-faint uppercase">
            남은 족보 둘러보기 · {lesson.hand.index + 1} / {lesson.hand.total}
          </p>
        )}
        <SpeechBubble bubble={lesson.hand !== undefined}>
          <h2 className="m-0 text-[17px] leading-tight font-bold text-content">{lesson.title}</h2>
          <p
            aria-live="polite"
            className="m-0 text-[14.5px] leading-relaxed text-content-muted"
            role="status"
          >
            {lesson.body}
          </p>
          {lesson.hand?.score !== undefined && <HandScore score={lesson.hand.score} />}
        </SpeechBubble>
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
            <span className="text-[12px] font-semibold text-brand-strong">
              표시된 곳을 눌러 보세요
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}

/** 플레이 신호. 안내가 따로 세지 않고 GamePlay가 넘겨준 값에서만 읽는다. */
interface PlaySignals {
  keptSixes: number
  motionNoticeVisible: boolean
  rolled: boolean
  rollCount: number
  rolling: boolean
  sixesOnTray: number
  submitted: boolean
}

/**
 * 플레이 신호를 보고 지금 서 있어야 할 단계. null이면 이 단계는 플레이로 넘어가지 않는다는
 * 뜻이고(버튼이 옮긴다), 그대로 머문다.
 *
 * 안내보다 빨리 플레이해도 억지로 되돌리지 않고 앞 단계를 건너뛴다. 인사 중에 이미 굴려
 * 버린 사람도 여기서 따라잡는다 — 인사를 눌러야만 넘어가면 먼저 굴린 사람은 남은 안내를
 * 통째로 놓친다.
 */
function stepFromPlay(step: GuideStep, play: PlaySignals): GuideStep | null {
  /*
   * 주사위가 날아가는 동안에는 어느 단계도 움직이지 않는다. rollCount는 굴림이 시작될 때
   * 올라가고 dice는 애니메이션이 끝나야 바뀌므로, 이 사이에 판단하면 "새 굴림 수 + 옛
   * 주사위"를 읽는다 — 두 번째 던지기가 날아가는 중에 옛 킵(2/2)이 새 선택을 끝낸 것으로
   * 보여 선택 단계를 건너뛰고 던지기 물음이 먼저 뜨던 버그가 그것이다.
   */
  if (play.rolling) return null
  // 족보 설명과 마무리는 버튼으로만 넘어간다 — 읽는 중에 판이 바뀌어도 끌려가면 안 된다.
  if (step === 'done' || step === 'categories') return null
  /*
   * 기록을 마치면 족보 둘러보기로 넘어간다. 먼저 한 칸을 직접 적어 본 뒤에 나머지를 배우는
   * 순서다 — 규칙 열두 개를 먼저 읽히면 무엇을 위한 규칙인지 모르는 채로 읽는다.
   */
  if (play.submitted) return 'categories'
  // 마지막 굴림을 쓰는 두 단계는 굴림 수만 본다.
  if (step === 'motion' || step === 'lastRoll') {
    return play.rollCount >= MAX_ROLLS ? 'record' : null
  }
  return PLAY_ADVANCE[step]?.(play) ?? null
}

/**
 * 단계별로 "무엇이 충족되면 어디로 가는가". 표로 두면 안내 순서가 한눈에 읽힌다 —
 * if 사슬로 늘어놓으면 순서가 코드 줄 순서에 숨는다.
 *
 * 여기 없는 단계(askLastRoll · motion · lastRoll · record · categories · done)는 위에서
 * 따로 다루거나 버튼으로만 넘어간다.
 */
const PLAY_ADVANCE: Partial<Record<GuideStep, (play: PlaySignals) => GuideStep | null>> = {
  // 인사 중에 이미 굴려 버린 사람도 여기서 따라잡는다.
  greet: (play) => (play.rolled ? 'keep' : null),
  roll: (play) => (play.rolled ? 'keep' : null),
  // 6이 두 개인데 하나만 킵하고 넘어가면 "같은 눈을 모은다"를 절반만 해본 셈이다.
  keep: (play) => (allSixesKept(play) ? 'reroll' : null),
  reroll: (play) => (play.rollCount >= 2 ? 'keepAgain' : null),
  // 두 번 고르고 나면 남은 한 번을 쓴다 — 센서가 있으면 흔들어서, 없으면 그냥 한 번 더.
  keepAgain: (play) => (allSixesKept(play) ? afterKeepAgain(play) : null),
}

function allSixesKept(play: PlaySignals) {
  return play.keptSixes >= play.sixesOnTray
}

/**
 * 두 번째 선택 뒤에 갈 곳. 안내보다 빨리 세 번을 다 굴려 버렸으면 굴릴 것이 없으니 바로
 * 기록으로 간다 — 남지도 않은 굴림을 어떻게 던질지 물으면 답할 방법이 없다.
 */
function afterKeepAgain(play: PlaySignals): GuideStep {
  return play.rollCount >= MAX_ROLLS ? 'record' : 'askLastRoll'
}

/** 버튼으로 넘기는 단계의 다음 칸. 나머지는 플레이 신호가 옮긴다. */
function nextOf(step: GuideStep, motionAvailable: boolean): GuideStep {
  if (step === 'greet') return 'roll'
  // 센서가 없는 기기에서는 물음이 한 갈래뿐이라 곧장 버튼 굴림으로 간다.
  if (step === 'askLastRoll') return motionAvailable ? 'motion' : 'lastRoll'
  // 흔들기를 마다한 사람도 마지막 굴림은 해야 한다 — 버튼으로 굴리는 같은 자리로 보낸다.
  if (step === 'motion') return 'lastRoll'
  // 족보를 다 둘러봤으면 마무리다.
  if (step === 'categories') return 'done'
  return step
}

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * 강조할 요소의 화면 좌표. 트레이가 리사이즈되거나 화면이 돌아가도 링이 따라가야 하므로
 * 한 번 재고 마는 대신 관찰한다. 단계가 바뀌면 selector가 바뀌어 저절로 다시 잰다.
 */
function useSpotlight(selector: string | null): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const target = document.querySelector(selector)
    const measure = () => {
      if (!target) {
        setRect(null)
        return
      }
      const box = target.getBoundingClientRect()
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
    }
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
    // ResizeObserver가 없는 환경(jsdom 등)에서도 안내는 그대로 떠야 한다 — 구멍이 따라다니지
    // 않을 뿐이고, resize 이벤트가 큰 변화는 이미 잡는다.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (target && observer) observer.observe(target)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [selector])

  return rect
}

/**
 * 강조한 곳만 빼고 화면을 덮는다. 눌러야 할 것 하나만 밝게 남으니 "여기"가 설명 없이 읽히고,
 * 덮인 자리는 클릭도 막혀 배우는 중에 엉뚱한 곳을 눌러 길을 잃지 않는다.
 *
 * 구멍 난 한 장이 아니라 네 장으로 둘러싸는 이유: box-shadow로 판 구멍은 그림자라 클릭을
 * 막지 못하고, clip-path로 판 구멍은 가장자리가 계단처럼 깨진다. 네 장이면 구멍의 네 변이
 * 정확히 맞고 각 장이 그대로 차단막이 된다.
 *
 * 누를 곳이 없는 단계(인사 · 마무리)는 통째로 덮어 읽는 데 집중시킨다.
 */
function Backdrop({ dim, spotlight }: { dim: boolean; spotlight: SpotlightRect | null }) {
  if (!spotlight) {
    return <div className="pointer-events-auto absolute inset-0 bg-black/72" />
  }

  const top = spotlight.top - 6
  const left = spotlight.left - 6
  const right = spotlight.left + spotlight.width + 6
  const bottom = spotlight.top + spotlight.height + 6
  // 구멍 주변만 덮는다 — 밝게 남은 한 곳이 곧 "여기를 누르세요"다.
  // dim이 꺼진 단계에서는 색만 빼고 차단막은 남긴다(dimsAroundHole 주석 참고).
  const block = cn('pointer-events-auto absolute', dim && 'bg-black/72')

  return (
    <>
      <div className={block} style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className={block} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div
        className={block}
        style={{ top, height: bottom - top, left: 0, width: Math.max(0, left) }}
      />
      <div className={block} style={{ top, height: bottom - top, left: right, right: 0 }} />
      <div
        className="pointer-events-none absolute rounded-[1.25rem] ring-3 ring-brand-strong motion-safe:animate-tutorial-halo"
        style={{ top, left, width: spotlight.width + 12, height: spotlight.height + 12 }}
      />
    </>
  )
}

/**
 * 설명 카드. 강조한 곳을 가리면 안 되므로 구멍의 반대쪽 절반에 붙는다 —
 * 아래를 밝혔으면 위로, 위를 밝혔으면 아래로.
 *
 * 폭은 26rem에서 멈추고 가운데 선다. 딤과 차단막은 뷰포트를 덮어야 하므로 이 오버레이의
 * 컨테이닝 블록은 뷰포트지만(구멍 좌표가 getBoundingClientRect 값이다), 카드는 **읽기 좋은
 * 한 덩어리**여야 한다 — 게임 열(max-w-play, 넓은 화면에서 1536px)에 맞추면 한 줄에 글자가
 * 100자 넘게 들어가 읽기 어렵고, 안의 버튼도 그만큼 멀어져 누르기 나쁘다.
 * mx-auto가 left/right 둘 다 잡힌 절대 요소를 상한 안에서 가운데로 되돌린다.
 * 모바일(375px)에서는 inset-x-4가 먼저 걸려 종전과 같은 343px이다.
 */
function Card({ children, spotlight }: { children: ReactNode; spotlight: SpotlightRect | null }) {
  const below = spotlight !== null && spotlight.top < window.innerHeight / 2

  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-x-4 mx-auto grid max-w-104 gap-2.5 rounded-card border border-white/20 bg-surface-raised p-4 shadow-raised',
        spotlight === null
          ? 'top-1/2 -translate-y-1/2'
          : below
            ? 'bottom-5'
            : 'top-[max(1rem,env(safe-area-inset-top))]',
      )}
    >
      <div className="flex items-start gap-3">
        <DiceBuddy className="motion-safe:animate-guide-bob" />
        <div className="grid min-w-0 flex-1 gap-2">{children}</div>
      </div>
    </div>
  )
}

/**
 * 족보 설명을 마스코트의 말풍선으로 감싼다. 꼬리가 왼쪽 마스코트를 가리켜 "이 친구가 하나씩
 * 말해 준다"로 읽힌다 — 규칙 나열이 아니라 설명으로 받아들여지는 차이다.
 *
 * 다른 단계는 감싸지 않고 그대로 통과시킨다. 굴리라고 재촉하는 문구까지 풍선에 넣으면
 * 카드마다 배경이 한 겹 더 생겨 화면이 무거워진다.
 */
function SpeechBubble({ bubble, children }: { bubble: boolean; children: ReactNode }) {
  if (!bubble) return <>{children}</>

  return (
    <div className="relative grid gap-2 rounded-control bg-surface-sunken px-3 py-2.5">
      {/* 꼬리. 풍선과 같은 배경을 45° 돌려 왼쪽 변에 반쯤 걸친다. */}
      <span
        aria-hidden="true"
        className="absolute top-4 -left-1 size-2.5 rotate-45 bg-surface-sunken"
      />
      {children}
    </div>
  )
}

function GuideTextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="cursor-pointer border-0 bg-transparent p-1 text-[12px] font-semibold text-content-faint underline underline-offset-2 transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

/** 요르 마스코트 — 눈이 주사위 눈(2)인 흰 주사위. */
function DiceBuddy({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-11 flex-none drop-shadow-[0_4px_8px_rgb(0_0_0_/_40%)]', className)}
      viewBox="0 0 64 64"
    >
      <rect fill="#FAFAF7" height="52" rx="15" stroke="rgb(0 0 0 / 12%)" width="52" x="6" y="6" />
      {/* 눈 두 개 = 주사위 2. 깜빡임 대신 고정 — 모션 최소화. */}
      <circle cx="23" cy="27" fill="#191919" r="4.4" />
      <circle cx="41" cy="27" fill="#191919" r="4.4" />
      <circle cx="24.6" cy="25.4" fill="#fff" r="1.4" />
      <circle cx="42.6" cy="25.4" fill="#fff" r="1.4" />
      {/* 발그레한 볼과 웃는 입 — 브랜드 레드를 살짝만 쓴다. */}
      <circle cx="17.5" cy="35" fill="rgb(229 57 53 / 28%)" r="3" />
      <circle cx="46.5" cy="35" fill="rgb(229 57 53 / 28%)" r="3" />
      <path
        d="M25 38.5c2.4 3.4 11.6 3.4 14 0"
        fill="none"
        stroke="#191919"
        strokeLinecap="round"
        strokeWidth="2.6"
      />
    </svg>
  )
}
