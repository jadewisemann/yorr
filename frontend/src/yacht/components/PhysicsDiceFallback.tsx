import { useEffect, useRef } from 'react'
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'
import { Dice } from './Dice'

type PhysicsDiceFallbackProps = {
  dice: PhysicsDiceSet | null
  held: PhysicsHeldDice
  /**
   * 이 주사위 줄이 무엇인지. 3D 실패 대체 화면일 때가 기본값이지만, 파티 모드 컨트롤러는
   * 이것을 <b>주 조작부</b>로 쓴다 — 거기서 "대체 화면"이라고 읽히면 안 된다.
   */
  label?: string
  message?: string
  onHeldToggle?: (index: PhysicsDiceIndex) => void
  onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
  releaseRequestId: string | null
  request: PhysicsDiceRollRequest | null
}

const INITIAL_DICE: PhysicsDiceSet = [1, 2, 3, 4, 5]
const DIE_KEYS = ['die-1', 'die-2', 'die-3', 'die-4', 'die-5'] as const

export function PhysicsDiceFallback({
  dice,
  held,
  label = '2D 주사위 대체 화면',
  message,
  onHeldToggle,
  onRollComplete,
  releaseRequestId,
  request,
}: PhysicsDiceFallbackProps) {
  const onRollCompleteRef = useRef(onRollComplete)
  const completedRef = useRef(new Set<string>())
  onRollCompleteRef.current = onRollComplete
  const displayedDice =
    request && releaseRequestId === request.requestId ? request.targetDice : (dice ?? INITIAL_DICE)

  useEffect(() => {
    if (
      !request ||
      releaseRequestId !== request.requestId ||
      completedRef.current.has(request.requestId)
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      if (completedRef.current.has(request.requestId)) return
      completedRef.current.add(request.requestId)
      onRollCompleteRef.current(request.requestId, request.targetDice)
    })
    return () => cancelAnimationFrame(frame)
  }, [releaseRequestId, request])

  return (
    <section
      // max-tiny: 320px에서는 트레이가 약 207px밖에 안 되고, 이 화면은 그 트레이를 inset-0으로
      // 통째로 덮는다 — 기본 여백(p-5)으로는 내용이 트레이 상·하단 띠(굴림 횟수 칩 · 킵 레일
      // 라벨) 자리까지 올라와 글자끼리 겹쳤다. 위쪽 띠 높이만큼 패딩을 얹고 좌우를 줄여
      // 주사위 다섯 개가 한 줄에 들어갈 폭을 만든다.
      className="absolute inset-0 grid content-center gap-6 bg-surface/70 p-5 max-tiny:gap-3 max-tiny:px-2 max-tiny:pt-9"
      aria-label={label}
    >
      {message && (
        <p className="m-0 text-center text-sm text-content-muted" role="status">
          {message}
        </p>
      )}
      {/*
        320px에서는 주사위를 줄인다. size-14 다섯 개(56×5 + gap 48 = 328px)는 그 폭에 한 줄로
        들어가지 않아 두 줄로 접히는데, 이 대체 화면은 트레이 안에 absolute inset-0으로 깔려
        있어서 두 줄이 되면 트레이 상·하단 띠(굴림 횟수 칩 · 킵 레일 라벨) 위로 겹쳐 그려졌다.
        size-11이면 44×5 + gap 32 = 252px로 한 줄에 들어간다(탭 타깃 44px 하한도 지킨다).
      */}
      <div className="flex flex-wrap justify-center gap-3 max-tiny:gap-2">
        {displayedDice.map((value, index) => (
          <button
            key={DIE_KEYS[index]}
            type="button"
            className="cursor-pointer rounded-card focus-ring focus-visible:outline-offset-2 disabled:cursor-default"
            disabled={!onHeldToggle || Boolean(request)}
            onClick={() => onHeldToggle?.(index as PhysicsDiceIndex)}
            aria-label={`${value} 주사위${held[index] ? ' KEEP 해제' : ' KEEP'}`}
            aria-pressed={held[index] ?? false}
          >
            <Dice
              className="max-tiny:size-11 max-tiny:p-1.5"
              held={held[index] ?? false}
              rolling={Boolean(request)}
              size="sm"
              value={value}
            />
          </button>
        ))}
      </div>
    </section>
  )
}
