import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { Button } from '@/shared/components/Button'
import { useAppStore } from '@/store'
import { LEVERAGE_MULTIPLIER, pickLeverageCategory } from '@/yacht/domain/leverage'
import {
  createLeverageClient,
  createLeverageSnapshot,
  LEVERAGE_PLAYER_ID,
  LEVERAGE_ROUNDS,
  leverageSession,
} from '@/yacht/domain/leverageGame'
import { YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'
import { categoryLabel, isRecorded } from '@/yacht/domain/yachtCategoryView'
import { useLocalRoomSnapshot } from '@/yacht/model/useLocalRoomSnapshot'
import { GamePlay } from './GamePlay'

export function LeveragePage() {
  const [run, setRun] = useState(0)

  return <LeverageRun key={run} onRestart={() => setRun((current) => current + 1)} />
}

function LeverageRun({ onRestart }: { onRestart: () => void }) {
  const navigate = useNavigate()
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  const [seed] = useState(() => Date.now() >>> 0)
  const [client] = useState(() => createLeverageClient(seed))
  const [initialSnapshot] = useState(createLeverageSnapshot)
  const snapshot = useLocalRoomSnapshot(client, initialSnapshot)

  useEffect(() => {
    client.connect()
    setConnectionStatus('connected')
    return () => setConnectionStatus('idle')
  }, [client, setConnectionStatus])

  const leave = () => {
    void navigate({ to: '/' })
  }

  const board = snapshot.game?.scores[LEVERAGE_PLAYER_ID]
  const used = YACHT_CATEGORIES.filter((category) => isRecorded(board?.categories[category]))
  const leverageCategory = pickLeverageCategory(seed, snapshot.game?.roundNumber ?? 1, used)

  if (snapshot.phase === 'finished') {
    return (
      <main className="mx-auto flex h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-gutter text-content">
        <p className="m-0 font-mono text-2xs font-bold tracking-[0.16em] text-content-muted uppercase">
          레버리지 · {LEVERAGE_ROUNDS}라운드 종료
        </p>
        <strong className="font-mono text-6xl leading-none font-bold tabular-nums">
          {board?.total ?? 0}
        </strong>
        <div className="grid w-full gap-2">
          <Button onClick={onRestart} size="cta">
            다시 하기
          </Button>
          <Button onClick={leave} variant="ghost">
            나가기
          </Button>
        </div>
      </main>
    )
  }

  return (
    <RealtimeClientProvider client={client}>
      <GamePlay
        guide={() => <LeverageNotice category={leverageCategory} />}
        leverageCategory={leverageCategory}
        onLeaveRequest={leave}
        roomId={leverageSession.roomId}
        session={leverageSession}
        snapshot={snapshot}
      />
    </RealtimeClientProvider>
  )
}

function LeverageNotice({ category }: { category: YachtCategory | null }) {
  if (!category) return null

  return (
    <p className="pointer-events-none absolute inset-x-0 top-2 z-sticky m-0 flex justify-center">
      <span className="rounded-full border border-brand bg-brand/15 px-3 py-1 text-xs font-bold text-brand-strong">
        이번 턴 ×{LEVERAGE_MULTIPLIER} — {categoryLabel[category]}
      </span>
    </p>
  )
}
