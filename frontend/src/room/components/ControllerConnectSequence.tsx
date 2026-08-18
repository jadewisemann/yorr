import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { DuelHowTo } from '@/duel/components/DuelHowTo'
import type { GameCode } from '@/games'
import { PingPongControllerHowTo } from '@/pingpong/components/PingPongControllerHowTo'
import { CONNECTED_HOLD_MS, CONNECTED_VIBRATE_MS, CONNECTING_MIN_MS } from '@/room/connectSequence'
import { cn } from '@/shared/cn'
import { Panel } from '@/shared/components/Panel'
import type { ConnectionStatus } from '@/store'

export type ControllerConnectStep = 'connecting' | 'connected' | 'ready'

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
  howTo?: ReactNode
}

export function ControllerConnectSequence({ howTo, status }: ControllerConnectSequenceProps) {
  const step = useConnectStep(status)
  const current = steps.findIndex((entry) => entry.key === step)

  return (
    <Panel
      as="section"
      aria-label="컨트롤러 연결"
      className="grid flex-none gap-3 p-3"
      surface="raised"
    >
      <ol className="m-0 flex list-none items-center gap-1.5 p-0">
        {steps.map((entry, index) => (
          <li className="flex flex-1 items-center gap-1.5" key={entry.key}>
            <span
              aria-hidden="true"
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                index <= current ? 'bg-brand' : 'bg-surface-veil-raised',
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

      {step === 'ready' && howTo}
    </Panel>
  )
}

function useConnectStep(status: ConnectionStatus): ControllerConnectStep {
  const [step, setStep] = useState<ControllerConnectStep>('connecting')
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
