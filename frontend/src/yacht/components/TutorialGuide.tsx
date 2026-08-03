import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import type { CategoryScores } from '@/yacht/domain/scoring'

interface TutorialGuideProps {
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
  /** 모션 센서를 켤 수 있는 기기인지. 아니면 흔들기 단계를 건너뛴다. */
  motionNoticeVisible: boolean
  /** 넓은 레이아웃인지. 점수표가 우측 패널이냐 아래 기록 패널이냐가 갈린다. */
  wide: boolean
  /** 연습을 끝내고 나간다. */
  onClose: () => void
}

type GuideStep = 'greet' | 'roll' | 'keep' | 'motion' | 'reroll' | 'categories' | 'record' | 'done'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 점수표를 보라고 할 때 무엇을 강조하느냐가 레이아웃마다 다르다. 좁은 화면에서 점수표는
 * 접혀 있는 바텀시트라 **손잡이**를 올려야 열리는데, 퀵 칩을 강조하면 그걸 누르게 되고
 * 그 순간 점수가 기록되며 턴이 끝나 버린다. 넓은 화면은 점수표가 이미 펼쳐져 있다.
 */
function spotlightFor(step: GuideStep, wide: boolean): string | null {
  switch (step) {
    case 'roll':
    case 'reroll':
      return '[data-tutorial="roll"]'
    case 'keep':
      return '[data-tutorial="tray"]'
    case 'motion':
      return '[data-tutorial="motion"]'
    case 'categories':
      return wide ? '[data-tutorial="sheet"]' : '[data-tutorial="sheet-handle"]'
    // 기록은 "아무거나"가 아니라 이번 대본이 만들어 준 식스를 콕 집어 누르게 한다.
    case 'record':
      return '[data-tutorial-category="sixes"]'
    default:
      return null
  }
}

interface Lesson {
  title: string
  body: string
  /** 눌러야 다음으로 가는 단계에는 버튼을 두지 않는다 — 직접 해보는 것이 요점이다. */
  action?: string
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
  wide: boolean
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
    case 'keep': {
      // 6이 아닌 걸 킵했으면 그것부터 알려 준다 — 초심자는 잘못 눌렀다는 것 자체를 모른다.
      if (ctx.keptOther > 0) {
        return {
          title: '6이 아닌 주사위를 킵했어요',
          body: '한 번 더 탭하면 킵이 풀려요. 지금은 6만 남겨 볼게요 — 같은 눈을 모을수록 점수가 커지거든요.',
        }
      }
      const left = ctx.sixes - ctx.keptSixes
      return {
        title: ctx.keptSixes > 0 ? `좋아요, ${left}개 남았어요` : `6이 ${ctx.sixes}개 나왔어요`,
        body:
          ctx.keptSixes > 0
            ? `나머지 6 ${left}개도 탭해서 킵해 보세요. 6을 전부 모아 두고 나머지만 다시 굴릴 거예요.`
            : '같은 눈을 모으면 점수가 커져요. 6이 그려진 주사위를 모두 탭해서 킵해 보세요 — 킵한 주사위는 다시 굴려도 그대로 남아요.',
      }
    }
    case 'categories':
      return {
        title: '족보는 점수표에서 봐요',
        body: ctx.wide
          ? '오른쪽 점수표에 족보 12개가 있어요. 지금 주사위로 각각 몇 점인지 미리 계산해서 보여주니 천천히 훑어보세요. 족보별 설명은 위 ? 도움말에 있어요.'
          : '표시된 손잡이를 위로 올리면 족보 12개가 담긴 점수표가 열려요. 지금 주사위로 각각 몇 점인지 미리 계산해서 보여주니 천천히 훑어보세요. 족보별 설명은 위 ? 도움말에 있어요.',
        action: '다 봤어요',
      }
    case 'reroll':
      return {
        title: '나머지만 다시 굴려요',
        body: '킵한 6은 그대로 두고 나머지만 다시 굴러가요. 6이 더 붙는지 볼까요? 굴리기를 한 번 더 눌러 보세요.',
      }
    case 'motion':
      return {
        title: '마지막 한 번은 흔들어서 굴려 볼까요?',
        body: '버튼 대신 실제로 주사위를 굴리듯 폰을 흔들어도 돼요. 표시된 "흔들기"를 눌러 센서를 켜고, 폰을 흔들어 마지막 굴림을 해보세요.',
        action: '괜찮아요, 넘어갈게요',
      }
    case 'record':
      return {
        title: `6이 ${ctx.sixes}개! 식스에 기록해요`,
        body: ctx.wide
          ? `표시된 식스 행을 누르면 ${ctx.sixesScore}점으로 기록되고 턴이 끝나요. 6은 한 개당 6점이라 모을수록 커져요.`
          : `아래 기록 패널에서 표시된 식스를 누르면 ${ctx.sixesScore}점으로 기록되고 턴이 끝나요. 6은 한 개당 6점이라 모을수록 커져요.`,
      }
    case 'done':
      return {
        title: '한 턴을 다 하셨어요!',
        body: '이걸 12번 반복하면 게임이 끝나고, 총점이 가장 높은 사람이 이겨요. 이제 실전에서 만나요.',
        action: '연습 끝내기',
      }
  }
}

/**
 * 연습 모드의 안내(S15P11A406-143). 완전 초심자가 대상이라 "읽고 알아서 하세요"로는 부족하다 —
 * 큰 카드로 한 번에 하나씩 말하고, **지금 눌러야 할 것 하나**에 강조 링을 씌운다.
 *
 * 눌러야 하는 단계에서는 화면을 덮지 않는다. 어둠을 깔면 "여기를 누르세요"라고 해놓고 그 손을
 * 막는다. 누를 곳이 없는 인사·마무리에서만 덮어 읽는 데 집중시킨다.
 *
 * 단계는 버튼이 아니라 실제 플레이(굴림 → 킵 → 기록)에 반응해 넘어간다. 직접 해봐야 배운다.
 */
export function TutorialGuide({
  candidates,
  keptValues,
  motionNoticeVisible,
  onClose,
  rolled,
  rollCount,
  submitted,
  wide,
}: TutorialGuideProps) {
  const [step, setStep] = useState<GuideStep>('greet')

  /*
   * 족보를 다 보고 나면 마지막 굴림 한 번이 남아 있다 — 그 한 번을 흔들기 체험에 쓴다.
   * 센서 안내가 없는 기기(데스크톱 등)에서는 켤 것이 없으므로 바로 기록으로 간다.
   */
  const afterCategories = (): GuideStep =>
    motionNoticeVisible && rollCount < 3 ? 'motion' : 'record'

  /*
   * 6의 개수는 대본을 믿지 않고 화면(식스 후보 점수)에서 거꾸로 센다 — 사용자가 안내와 다르게
   * 킵해 대본과 어긋나는 순간 틀린 숫자를 우길 이유가 없다.
   */
  const sixesScore = candidates.sixes ?? 0
  const sixesOnTray = Math.round(sixesScore / 6)
  const keptSixes = keptValues.filter((value) => value === 6).length
  const keptOther = keptValues.filter((value) => value !== 6).length

  useEffect(() => {
    const next = stepFromPlay(step, { keptSixes, rolled, rollCount, sixesOnTray, submitted })
    if (next) setStep(next)
  }, [keptSixes, rolled, rollCount, sixesOnTray, step, submitted])

  const spotlight = useSpotlight(spotlightFor(step, wide))
  const lesson = lessonFor(step, { keptOther, keptSixes, sixes: sixesOnTray, sixesScore, wide })

  return (
    // 래퍼는 클릭을 통과시킨다 — 여기서 막으면 강조해 놓은 버튼조차 눌리지 않는다.
    <div className="pointer-events-none fixed inset-0 z-modal" role="presentation">
      <Backdrop spotlight={spotlight} />
      <Card spotlight={spotlight}>
        <h2 className="m-0 text-[17px] leading-tight font-bold text-content">{lesson.title}</h2>
        <p
          aria-live="polite"
          className="m-0 text-[14.5px] leading-relaxed text-content-muted"
          role="status"
        >
          {lesson.body}
        </p>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <GuideTextButton label="연습 그만두기" onClick={onClose} />
          {lesson.action ? (
            <Button
              onClick={step === 'done' ? onClose : () => setStep(nextOf(step, afterCategories))}
              size="sm"
              variant="secondary"
            >
              {lesson.action}
            </Button>
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
  rolled: boolean
  rollCount: number
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
  // 마무리와 족보 훑기는 버튼으로만 넘어간다 — 족보를 보는 중에 굴림 수가 바뀌어도 끌려가면 안 된다.
  if (step === 'done' || step === 'categories') return null
  // 흔들기 단계는 세 번째 굴림이 끝나면 스스로 빠진다.
  if (step === 'motion') return play.rollCount >= 3 ? 'record' : null
  if (play.submitted) return 'done'
  if ((step === 'greet' || step === 'roll') && play.rolled) return 'keep'
  // 6이 두 개인데 하나만 킵하고 넘어가면 "같은 눈을 모은다"를 절반만 해본 셈이다.
  if (step === 'keep' && play.keptSixes >= play.sixesOnTray) return 'reroll'
  if (step === 'reroll' && play.rollCount >= 2) return 'categories'
  return null
}

/** 버튼으로 넘기는 단계의 다음 칸. 나머지는 플레이 신호가 옮긴다. */
function nextOf(step: GuideStep, afterCategories: () => GuideStep): GuideStep {
  if (step === 'greet') return 'roll'
  if (step === 'categories') return afterCategories()
  if (step === 'motion') return 'record'
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
    const measure = () => {
      const target = document.querySelector(selector)
      if (!target) {
        setRect(null)
        return
      }
      const box = target.getBoundingClientRect()
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
    }
    measure()
    window.addEventListener('resize', measure)
    // ResizeObserver가 없는 환경(jsdom 등)에서도 안내는 그대로 떠야 한다 — 구멍이 따라다니지
    // 않을 뿐이고, resize 이벤트가 큰 변화는 이미 잡는다.
    const target = document.querySelector(selector)
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
 * 눌러야 할 곳이 있는 단계에서는 화면을 어둡게 덮지 않는다 — 어둠을 깔면 "여기를 누르세요"라고
 * 해놓고 정작 그 버튼을 가린다. 대신 강조 링만 씌우고, 링 **바깥**에는 보이지 않는 차단막을
 * 깔아 다른 버튼은 눌리지 않게 한다. 배우는 중에 엉뚱한 곳을 눌러 길을 잃지 않도록.
 *
 * 차단막을 구멍 뚫린 한 장 대신 네 장으로 두는 이유: box-shadow로 판 구멍은 그림자라 클릭을
 * 막지 못하고, clip-path로 판 구멍은 가장자리가 계단처럼 깨진다.
 *
 * 누를 곳이 없는 단계(인사 · 마무리)는 통째로 덮어 읽는 데 집중시킨다.
 */
function Backdrop({ spotlight }: { spotlight: SpotlightRect | null }) {
  if (!spotlight) {
    return <div className="pointer-events-auto absolute inset-0 bg-black/72" />
  }

  const top = spotlight.top - 6
  const left = spotlight.left - 6
  const right = spotlight.left + spotlight.width + 6
  const bottom = spotlight.top + spotlight.height + 6
  const block = 'pointer-events-auto absolute'

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
 */
function Card({ children, spotlight }: { children: ReactNode; spotlight: SpotlightRect | null }) {
  const below = spotlight !== null && spotlight.top < window.innerHeight / 2

  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-x-4 grid gap-2.5 rounded-card border border-white/20 bg-surface-raised p-4 shadow-raised',
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
