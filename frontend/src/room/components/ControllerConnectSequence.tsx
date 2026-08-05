import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { DuelHowTo } from '@/duel/DuelHowTo'
import type { GameCode } from '@/games'
import { PingPongControllerHowTo } from '@/pingpong/PingPongControllerHowTo'
import { CONNECTED_HOLD_MS, CONNECTED_VIBRATE_MS, CONNECTING_MIN_MS } from '@/room/connectSequence'
import { cn } from '@/shared/cn'
import type { ConnectionStatus } from '@/store'

/**
 * 파티 모드 폰이 컨트롤러가 되기까지의 안내. (S15P11A406-205)
 *
 * QR을 찍고 들어온 폰은 대기실에서 <b>아무것도 하지 않고</b> 방장이 시작하기를 기다린다 —
 * 그 사이 화면에 있던 건 큰 화면에 이미 떠 있는 QR 패널(`InvitePopover`)뿐이라, 폰을 든
 * 사람은 자기가 붙었는지도, 이제 뭘 하는지도 알 수 없었다. 이 자리를 연결 단계와 게임별
 * 사용법으로 채운다.
 *
 * <b>게임별 사용법은 여기서 만들지 않는다.</b> "폰을 흔든다"(야추)와 "폰을 라켓처럼
 * 휘두른다"(탁구)는 이 컴포넌트가 알 수 없는 것이고, 알게 되는 순간 게임이 늘 때마다
 * 이 파일이 자란다. 마지막 단계는 슬롯으로 비워 두고 {@link controllerHowTo}가 채운다.
 */
export type ControllerConnectStep = 'connecting' | 'connected' | 'ready'

/**
 * 게임별 컨트롤러 사용법 — 마지막 단계 슬롯에 들어갈 컴포넌트 표.
 *
 * <b>슬롯 계약(S15P11A406-206 · 207이 여기에 한 줄씩 더한다):</b>
 *
 * 1. 사용법 컴포넌트는 <b>자기 게임 폴더</b>에 만든다(`yacht/components/…`,
 *    `pingpong/components/…`). `room/`은 게임을 모른다.
 * 2. <b>props를 받지 않는다.</b> 필요한 값(내 차례인지·센서를 쓸 수 있는지)은 store나
 *    자기 게임 훅에서 직접 읽는다 — room이 게임별 인자를 중계하기 시작하면 이 표의
 *    타입이 게임 수만큼 갈라진다.
 * 3. 바깥은 이미 카드(`rounded-panel border bg-surface-raised`)다. 안에서 카드를 또
 *    그리지 말고 내용만 넣는다. 세로 공간은 대기실 높이를 나눠 쓰므로 짧게.
 * 4. 여기 등록만 하면 대기실에 뜬다. 등록이 없는 게임은 3단계가 기본 문구로 뜬다 —
 *    비어 있어도 화면이 깨지지 않는다.
 *
 * 등록 예: `{ YACHT_DICE: YachtControllerHowTo }`
 */
export const controllerHowTo: Partial<Record<GameCode, ComponentType>> = {
  DUEL: DuelHowTo,
  PING_PONG: PingPongControllerHowTo,
}

const steps = [
  { key: 'connecting', label: '연결 중', detail: '컨트롤러를 방에 연결하고 있어요' },
  { key: 'connected', label: '연결됨', detail: '이 폰이 컨트롤러가 됐어요' },
  { key: 'ready', label: '준비 완료', detail: '방장이 시작하면 바로 이어져요' },
] as const satisfies readonly { key: ControllerConnectStep; label: string; detail: string }[]

interface ControllerConnectSequenceProps {
  status: ConnectionStatus
  /** 마지막 단계에 꽂히는 게임별 사용법. 보통 {@link controllerHowTo}에서 꺼내 넘긴다. */
  howTo?: ReactNode
}

export function ControllerConnectSequence({ howTo, status }: ControllerConnectSequenceProps) {
  const step = useConnectStep(status)
  const current = steps.findIndex((entry) => entry.key === step)

  return (
    <section
      aria-label="컨트롤러 연결"
      className="grid flex-none gap-3 rounded-panel border border-border bg-surface-raised p-3"
    >
      <ol className="m-0 flex list-none items-center gap-1.5 p-0">
        {steps.map((entry, index) => (
          <li className="flex flex-1 items-center gap-1.5" key={entry.key}>
            <span
              aria-hidden="true"
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                index <= current ? 'bg-brand' : 'bg-white/12',
              )}
            />
            <span
              className={cn(
                'text-2xs font-semibold whitespace-nowrap',
                index === current ? 'text-content' : 'text-content-faint',
              )}
            >
              {entry.label}
            </span>
          </li>
        ))}
      </ol>

      <p className="m-0 flex items-center gap-2 text-sm text-content-muted" role="status">
        {step === 'connecting' && (
          <span
            aria-hidden="true"
            className="size-3.5 flex-none animate-spin-slow rounded-full border-2 border-border border-t-brand motion-reduce:animate-none"
          />
        )}
        {steps[current]?.detail}
      </p>

      {/* 사용법은 마지막 단계에서만 편다 — 아직 붙지도 않았는데 "이렇게 흔드세요"부터
          읽히면, 흔들어 보고 아무 일도 안 일어나는 순간 연결이 고장난 줄 안다. */}
      {step === 'ready' && howTo}
    </section>
  )
}

/**
 * 연결 상태를 단계로 옮긴다. 두 지연이 붙는 이유가 서로 다르다:
 *
 * - `CONNECTING_MIN_MS` — '연결 중'의 <b>최소</b> 노출. 로컬·LTE에서는 연결이 순식간이라
 *   단계가 깜빡이고 사라진다. 이미 그만큼 지났으면 더 기다리지 않는다(느린 회선에서
 *   붙었는데도 화면이 안 넘어가는 게 훨씬 나쁘다).
 * - `CONNECTED_HOLD_MS` — '연결됨'을 읽을 시간. 진동도 이 순간 함께 울린다.
 */
function useConnectStep(status: ConnectionStatus): ControllerConnectStep {
  const [step, setStep] = useState<ControllerConnectStep>('connecting')
  // '연결 중'이 화면에 뜬 시각. 재연결로 되돌아올 때마다 다시 찍는다.
  const connectingSince = useRef(Date.now())

  useEffect(() => {
    if (status !== 'connected') {
      connectingSince.current = Date.now()
      setStep('connecting')
      return
    }

    const remaining = Math.max(0, CONNECTING_MIN_MS - (Date.now() - connectingSince.current))
    const toConnected = window.setTimeout(() => {
      setStep('connected')
      // iOS Safari에는 vibrate가 없다 — 있는 기기에서만 울린다.
      if ('vibrate' in navigator) navigator.vibrate(CONNECTED_VIBRATE_MS)
    }, remaining)
    const toReady = window.setTimeout(() => setStep('ready'), remaining + CONNECTED_HOLD_MS)

    return () => {
      window.clearTimeout(toConnected)
      window.clearTimeout(toReady)
    }
  }, [status])

  return step
}
