import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { Button } from '@/shared/components/Button'
import { useAppStore } from '@/store'
import { LEVERAGE_MULTIPLIER, pickLeverageCategory } from '@/yacht/domain/leverage'
import { YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'
import {
  createLeverageClient,
  createLeverageSnapshot,
  LEVERAGE_PLAYER_ID,
  LEVERAGE_ROUNDS,
  leverageSession,
} from '@/yacht/leverageGame'
import { categoryLabel, isRecorded } from '@/yacht/yachtCategoryView'
import { GamePlay } from './GamePlay'
import { useLocalRoomSnapshot } from './useLocalRoomSnapshot'

/**
 * 레버리지 다이스(S15P11A406-208). 매 턴 족보 하나가 뽑히고, 그 족보에 기록하면 점수가 2배다.
 *
 * 연습 모드와 같은 방식으로 <b>실제 플레이 화면 그대로</b>를 띄우고 서버 자리에만 로컬 판을
 * 넣는다 — 변형 룰 하나 때문에 화면을 새로 그리면 그때부터 두 화면이 따로 늙는다.
 * 온라인 멀티는 백엔드가 2배 규칙을 알아야 해서 후속 티켓이다.
 */
export function LeveragePage() {
  // 판을 다시 시작하면 시드·클라이언트·점수판을 통째로 새로 만든다 — 리마운트가 곧 새 판이다.
  const [run, setRun] = useState(0)

  return <LeverageRun key={run} onRestart={() => setRun((current) => current + 1)} />
}

function LeverageRun({ onRestart }: { onRestart: () => void }) {
  const navigate = useNavigate()
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus)
  // 판 전체의 난수 원본. 화면(미리보기)과 로컬 서버(기록 점수)가 같은 시드를 봐야
  // 2배가 걸린 칸이 어긋나지 않는다.
  const [seed] = useState(() => Date.now() >>> 0)
  const [client] = useState(() => createLeverageClient(seed))
  const [initialSnapshot] = useState(createLeverageSnapshot)
  const snapshot = useLocalRoomSnapshot(client, initialSnapshot)

  /*
   * GamePlay는 연결 상태를 스토어에서 읽어 조작을 잠근다(재연결 중 오조작 방지). 로컬 판에는
   * 연결이랄 게 없으므로 들어올 때 연결됨으로 두고, 나갈 때 되돌린다.
   */
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
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          레버리지 · {LEVERAGE_ROUNDS}라운드 종료
        </p>
        <strong className="font-mono text-[64px] leading-none font-bold tabular-nums">
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
        // 안내 자리를 빌려 이번 턴의 2배 족보를 띄운다. 점수표를 열지 않아도 보여야 한다 —
        // 모바일에서 점수표는 접혀 있다.
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

/** 트레이 위에 얹히는 한 줄. 안내 자리(guide)는 흐름에서 자리를 차지하지 않는다. */
function LeverageNotice({ category }: { category: YachtCategory | null }) {
  if (!category) return null

  return (
    <p className="pointer-events-none absolute inset-x-0 top-2 z-sticky m-0 flex justify-center">
      <span className="rounded-full border border-brand bg-brand/15 px-3 py-1 text-[12px] font-bold text-brand-strong">
        이번 턴 ×{LEVERAGE_MULTIPLIER} — {categoryLabel[category]}
      </span>
    </p>
  )
}
