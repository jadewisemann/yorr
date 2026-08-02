import { useEffect, useState } from 'react'
import { cn } from '@/cn'
import { Button } from './Button'

interface TutorialGuideProps {
  /** 지금 내 차례인지. 아니면 마스코트가 "차례 오면 알려줄게" 하고 기다린다. */
  isMyTurn: boolean
  /** 이번 턴에 주사위가 깔려 있는지(첫 굴림 완료). */
  rolled: boolean
  /** 킵한 주사위가 하나라도 있는지. */
  kept: boolean
  /** 이번 턴 기록까지 끝났는지. */
  submitted: boolean
  /** 시퀀스를 끝까지 봤다 — 부모가 쿠키에 기록하고 치운다. */
  onFinish: () => void
  /** 이번 판만 치운다. 다음 게임에서는 다시 나온다. */
  onSkip: () => void
  /** "다시 보지 않기" — 부모가 쿠키에 기록하고 치운다. */
  onNeverShowAgain: () => void
}

type GuideStep = 'greet' | 'waitTurn' | 'roll' | 'keep' | 'record' | 'done'

const DONE_LINGER_MS = 3500

const SCRIPT: Record<GuideStep, string> = {
  greet: '안녕, 난 요르! 요트다이스가 처음이구나? 한 턴만 옆에서 따라다니며 알려줄게.',
  waitTurn: '지금은 다른 사람 차례야. 네 차례가 오면 바로 알려줄게!',
  roll: '네 차례야! 굴리기 버튼을 누르거나 폰을 흔들어서 주사위를 굴려 봐. 턴마다 최대 3번까지 굴릴 수 있어.',
  keep: '주사위가 나왔네! 남기고 싶은 주사위를 탭하면 킵 돼. 킵한 건 그대로 두고 나머지만 다시 굴리는 거야.',
  record: '마음에 들면 이제 족보를 탭해서 기록해! 점수표의 미리보기 숫자가 그대로 네 점수가 돼.',
  done: '완벽해, 이제 진짜 시작이야! 궁금한 게 생기면 언제든 위의 ? 버튼을 눌러 줘.',
}

/** 단계마다 마스코트가 관련 UI 근처로 미끄러져 간다 — 트레이 기준 절대 위치. */
const PLACEMENT: Record<GuideStep, string> = {
  greet: 'inset-x-4 top-1/2 -translate-y-1/2',
  waitTurn: 'inset-x-4 top-1/2 -translate-y-1/2',
  roll: 'inset-x-4 bottom-12',
  keep: 'inset-x-4 top-1/2 -translate-y-1/2',
  record: 'inset-x-4 bottom-10',
  done: 'inset-x-4 top-1/2 -translate-y-1/2',
}

function nextGuideStep(
  step: GuideStep,
  {
    isMyTurn,
    kept,
    rolled,
    submitted,
  }: Pick<TutorialGuideProps, 'isMyTurn' | 'kept' | 'rolled' | 'submitted'>,
) {
  if (step === 'done') return step
  if (submitted && step !== 'greet') return 'done'

  const playing = step === 'roll' || step === 'keep' || step === 'record'
  if (playing && !isMyTurn) return 'waitTurn'
  if (step === 'waitTurn' && isMyTurn) return 'roll'
  if (step === 'roll' && rolled) return 'keep'
  if (step === 'keep' && kept) return 'record'
  return step
}

/**
 * 첫 판을 함께 도는 마스코트 가이드. 버튼으로 넘기는 슬라이드가 아니라
 * 실제 플레이(굴림 → 킵 → 기록)에 반응해 다음 안내로 넘어간다 —
 * 화면을 잠그지 않으므로 안내를 읽으면서 그대로 조작하면 된다.
 */
export function TutorialGuide({
  isMyTurn,
  kept,
  onFinish,
  onNeverShowAgain,
  onSkip,
  rolled,
  submitted,
}: TutorialGuideProps) {
  const [step, setStep] = useState<GuideStep>('greet')

  // 진행 신호를 보고 다음 단계로 넘어간다. 사용자가 안내보다 빨리 플레이해도
  // (인사 중에 기록까지 끝내도) 억지로 되돌리지 않고 앞 단계를 건너뛴다.
  useEffect(() => {
    const next = nextGuideStep(step, { isMyTurn, kept, rolled, submitted })
    if (next !== step) setStep(next)
  }, [isMyTurn, kept, rolled, step, submitted])

  // 마지막 인사는 잠깐 머물고 스스로 퇴장한다 — 완료를 쿠키에 남기는 건 부모 몫.
  useEffect(() => {
    if (step !== 'done') return
    const timeout = setTimeout(onFinish, DONE_LINGER_MS)
    return () => clearTimeout(timeout)
  }, [onFinish, step])

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-20 flex items-end justify-center gap-2.5 transition-all duration-500 ease-out',
        PLACEMENT[step],
      )}
    >
      <DiceBuddy className="motion-safe:animate-guide-bob" />
      <div className="pointer-events-auto grid max-w-72 gap-2.5 rounded-card rounded-bl-[4px] border border-white/18 bg-surface-raised/95 p-3.5 shadow-raised">
        {/* 단계가 바뀔 때마다 새 대사를 스크린리더에도 읽어 준다. */}
        <p
          aria-live="polite"
          className="m-0 text-[13.5px] leading-relaxed text-content"
          role="status"
        >
          {SCRIPT[step]}
        </p>
        {step === 'greet' && (
          <Button
            onClick={() => setStep(isMyTurn ? 'roll' : 'waitTurn')}
            size="sm"
            variant="secondary"
          >
            좋아, 알려줘!
          </Button>
        )}
        {step === 'keep' && (
          <Button onClick={() => setStep('record')} size="sm" variant="ghost">
            알겠어, 다음은?
          </Button>
        )}
        {step !== 'done' && (
          <div className="flex items-center justify-end gap-3">
            <GuideTextButton label="건너뛰기" onClick={onSkip} />
            <GuideTextButton label="다시 보지 않기" onClick={onNeverShowAgain} />
          </div>
        )}
      </div>
    </div>
  )
}

function GuideTextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="min-h-tap cursor-pointer border-0 bg-transparent px-1 py-0 text-[11px] font-semibold text-content-faint underline underline-offset-2 transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

/** 요르 마스코트 — 눈이 주사위 눈(2)인 흰 주사위. 트레이의 매트 블랙 위에서 잘 뜬다. */
function DiceBuddy({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-14 flex-none drop-shadow-[0_6px_10px_rgb(0_0_0_/_45%)]', className)}
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
