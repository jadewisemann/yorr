import type { RoomSnapshot } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { useMediaQuery } from '@/shared/useMediaQuery'
import type { ActiveRoomSession } from '@/store'
import { type RankedPlayer, ResultRanking } from '@/yacht/components/ResultRanking'
import { ScoreMatrix } from '@/yacht/components/ScoreMatrix'

/**
 * 파티 모드 대시보드가 보는 최종 결과 — <b>여러 사람의 결과</b>가 화면 전체를 채운다.
 *
 * 폰이 보는 {@link GameResult}를 그대로 쓸 수 없다. 그 화면은 "내 등수 · 내 점수 · 내 보너스"가
 * 위쪽 절반을 차지하는데, 대시보드는 플레이어가 아니라 그 자리에 넣을 값이 없다. 그대로 두면
 * 서버 명단에 없는 세션이 <b>꼴등 0점</b>으로 계산되어 TV에 유령 플레이어가 뜬다.
 *
 * <b>프레임은 대기·진행 화면에서 그대로 가져온다</b>(`max-w-play`,
 * `grid-cols-[minmax(0,1fr)_28rem]`, 폭 분기 1024px). 대기 화면이 {@link GamePlay}와 골격을
 * 맞춘 이유가 여기서도 같다 — 게임이 끝나는 순간 폰 프레임(`max-w-2xl` + safe-area 패딩)으로
 * 갈아타면 큰 화면 가운데에 좁은 기둥 하나만 남는다:
 *
 * <pre>
 *   헤더(최종 결과·방 코드)   → GamePlayHeader · 대기 화면 헤더
 *   라운드·인원 한 줄         → TurnStrip
 *   최종 순위(주인공)         → GameDiceTray 자리
 *   방장 안내 띠              → [굴리기] 자리
 *   점수표 열(28rem·border-l) → ScoreSheet
 * </pre>
 *
 * <b>전체 점수표를 BottomSheet에 넣지 않는다.</b> 폰에서는 탭해서 여는 것이 맞지만 TV·모니터를
 * 손가락으로 열 사람은 없다 — 처음부터 오른쪽 열에 펼쳐 둔다.
 *
 * <b>[대기실로] 버튼도 두지 않는다.</b> 대시보드는 방장이 아니다(방장은 처음 들어온 컨트롤러다).
 * 누를 수 없는 버튼을 회색으로 세워 두는 대신, 누가 눌러야 하는지를 문장으로 알린다.
 */
const WIDE_LAYOUT = '(min-width: 1024px)'

interface PartyResultDashboardProps {
  /** 방 닫기. GamePage의 RoomExitGuard가 확인을 받고 처리한다(GamePlay와 같은 경로). */
  onLeaveRequest: () => void
  /** 서버가 확정한 최종 순위. 계산은 {@link GameResult}가 한다 — 두 화면이 같은 값을 봐야 한다. */
  ranked: RankedPlayer[]
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function PartyResultDashboard({
  onLeaveRequest,
  ranked,
  session,
  snapshot,
}: PartyResultDashboardProps) {
  const wide = useMediaQuery(WIDE_LAYOUT)
  const winner = ranked[0]

  return (
    <main
      className={cn(
        'mx-auto h-svh w-full max-w-play overflow-hidden bg-canvas text-content',
        wide ? 'grid grid-cols-[minmax(0,1fr)_28rem]' : 'flex flex-col',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-none items-center gap-3 border-b border-border px-gutter py-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 text-[19px] font-bold">최종 결과 · 요트 다이스</h1>
            <p className="m-0 flex items-center gap-2 text-[13px] text-content-muted">
              <span className="font-mono font-bold tracking-[0.12em] text-content">
                {session.roomCode}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
              참가자 {ranked.length}명
            </p>
          </div>
          {/* 대시보드는 플레이어가 아니다 — '나가기'가 아니라 방을 닫는 것이다(대기 화면과 같다). */}
          <Button
            className="flex-none px-3.5 text-sm"
            onClick={onLeaveRequest}
            type="button"
            variant="danger"
          >
            방 닫기
          </Button>
        </header>

        {/* TurnStrip이 있던 자리. 진행 중 "누구 차례"가 서 있던 높이를 결과에서도 지킨다. */}
        <p className="m-0 flex flex-none items-center gap-2 border-b border-border px-gutter py-2.5 text-[13px] text-content-muted">
          {snapshot.game?.roundNumber ?? 12}라운드 종료
          {winner && (
            <>
              <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
              <span className="truncate">
                우승 <span className="font-bold text-content">{winner.nickname}</span>
              </span>
            </>
          )}
        </p>

        {/* 화면의 주인공. 큰 화면에서 여러 사람이 동시에 읽으므로 폰보다 크게 세운다
            (ResultRanking 자체가 스크롤 컨테이너 — 인원이 늘어도 프레임은 고정이다). */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-gutter py-4">
          <h2 className="m-0 flex-none font-mono text-[12px] font-bold tracking-[0.16em] text-content-muted uppercase">
            Final Standings
          </h2>
          <ResultRanking
            className="min-h-0 flex-1 auto-rows-min content-start overflow-y-auto text-[1.15em]"
            players={ranked}
            you={session.you}
          />
        </div>

        {/* [굴리기]·[게임 시작]이 있던 띠. 대시보드는 누를 것이 없으니 안내만 남는다. */}
        <footer className="flex flex-none items-center justify-center border-t border-border px-gutter py-4">
          <p className="m-0 text-center text-[15px] text-content-muted" role="status">
            방장이 대기실로 옮기면 같은 멤버로 다시 시작해요.
          </p>
        </footer>
      </div>

      {/* ScoreSheet가 있던 열. 폰과 달리 처음부터 펼쳐 둔다 — TV를 탭할 사람은 없다. */}
      {wide && (
        <section aria-label="전체 점수표" className="flex min-h-0 flex-col border-l border-border">
          <h2 className="m-0 flex-none px-3 pt-2.5 pb-1.5 text-[15px] font-bold tracking-[0.02em]">
            전체 점수표
          </h2>
          <ScoreMatrix
            className="min-h-0 flex-1"
            players={ranked.map((player) => ({
              nickname: player.nickname,
              playerId: player.playerId,
              scoreboard: snapshot.game?.scores[player.playerId],
            }))}
          />
        </section>
      )}
    </main>
  )
}
