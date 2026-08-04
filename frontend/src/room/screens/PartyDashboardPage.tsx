import { useNavigate } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect } from 'react'
import { gameByKey } from '@/games'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import { useCreatePartyRoom } from '@/room/api/useRoomApi'
import { createInviteUrl, QrFallback } from '@/room/components/InvitationPanel'
import { PlayerCard } from '@/room/components/PlayerCard'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { useMediaQuery } from '@/shared/useMediaQuery'
import { useAppStore } from '@/store'

/**
 * 파티 모드 대시보드 대기 화면 — 큰 화면이 게임판이 되고, 사람들은 QR을 찍어 폰으로 붙는다.
 *
 * <b>랜딩 팔레트를 문 앞에서 버린다.</b> `--ds-landing-*` 대신 게임 화면과 같은
 * `bg-canvas`/`border-border`/`text-content`를 쓰고, 프레임(`max-w-play`,
 * `grid-cols-[minmax(0,1fr)_28rem]`)과 네 개의 띠를 {@link GamePlay}에서 그대로 가져온다.
 * 시작 순간에 팔레트나 골격이 바뀌면 "이어지는 화면"이 될 수 없기 때문이다:
 *
 * <pre>
 *   헤더(게임·방 코드)     → GamePlayHeader
 *   인원 한 줄             → TurnStrip
 *   QR 블록                → GameDiceTray
 *   방장 안내 띠            → [굴리기] · 모두 해제
 *   참가자 열(28rem·border-l) → ScoreSheet
 * </pre>
 * <p>
 * <b>조작 버튼은 두지 않는다.</b> 대시보드는 방장이 아니다 — 방장은 처음 들어온 컨트롤러이고
 * (백엔드 {@code RoomValidationService}의 JOIN 규약), 게임 시작·봇 추가는 그 폰의 대기실에서
 * 한다. TV·모니터에 마우스를 기대하지 않는 것과 같은 이유다.
 *
 * 폭 분기도 랜딩 기준(760px)이 아니라 <b>게임 화면 기준(1024px)</b>을 쓴다 — 시작 전후가
 * 같은 지점에서 같은 모양으로 꺾여야 한다.
 */
const WIDE_LAYOUT = '(min-width: 1024px)'

export type PartyGameKey = 'pingpong' | 'yacht'

export function PartyDashboardPage({ gameKey }: { gameKey: PartyGameKey }) {
  const navigate = useNavigate()
  const game = gameByKey(gameKey)
  const wide = useMediaQuery(WIDE_LAYOUT)
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const createParty = useCreatePartyRoom()

  const isDashboard = roomSession?.membershipRole === 'dashboard'
  const capacity = roomSnapshot?.capacity ?? 6
  const players = roomSnapshot?.players ?? []
  const hostId = roomSnapshot?.hostId

  // 진입 즉시 방을 연다. 대시보드는 이름을 짓지 않으므로 사이에 화면이 없다.
  // 이미 대시보드 세션이 있으면(새로고침) 그것을 이어 쓴다 — 새 방을 열면 QR이 바뀌어
  // 이미 찍고 들어온 사람들이 남의 방을 보게 된다.
  useEffect(() => {
    if (isDashboard || createParty.isLoading || createParty.error) return
    if (game.gameCode) void createParty.execute(game.gameCode)
  }, [createParty, game.gameCode, isDashboard])

  useEffect(() => playLandingSoundtrack(gameKey), [gameKey])

  // 게임이 시작되면 관전 뷰로 넘어간다. 이동은 phase가 시킨다(방 전체가 함께 움직인다).
  useEffect(() => {
    if (!isDashboard || !roomSession || !roomSnapshot || roomSnapshot.phase === 'waiting') return
    void navigate({
      to: '/rooms/$roomId/game',
      params: { roomId: roomSession.roomId },
      replace: true,
    })
  }, [isDashboard, navigate, roomSession, roomSnapshot])

  if (!isDashboard || !roomSession) {
    return (
      <PartyOpeningNotice error={createParty.error} onHome={() => void navigate({ to: '/' })} />
    )
  }

  const host = players.find((player) => player.playerId === hostId)

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
            <h1 className="m-0 text-[19px] font-bold">파티 모드 · {game.name}</h1>
            <p className="m-0 flex items-center gap-2 text-[13px] text-content-muted">
              <span className="font-mono font-bold tracking-[0.12em] text-content">
                {roomSession.roomCode}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-white/18" />
              <span className="inline-flex items-center gap-1.5" role="status">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    connectionStatus === 'connected' ? 'bg-positive' : 'bg-warning',
                  )}
                />
                {connectionLabel(connectionStatus)}
              </span>
            </p>
          </div>
          {/* 대시보드는 플레이어가 아니다 — '나가기'가 아니라 방을 닫는 것이다. */}
          <Button
            className="flex-none px-3.5 text-sm"
            onClick={() => void navigate({ to: '/' })}
            type="button"
            variant="danger"
          >
            방 닫기
          </Button>
        </header>

        {/* TurnStrip이 들어설 자리. 시작 전에는 인원 한 줄이 같은 높이를 지킨다. */}
        <p className="m-0 flex flex-none items-center gap-2 border-b border-border px-gutter py-2.5 text-[13px] text-content-muted">
          참가자 {players.length}명
          <span aria-hidden="true" className="h-3 w-px bg-white/18" />
          최대 {capacity}명
        </p>

        {/* GameDiceTray가 들어설 컨테이너. 같은 클래스라 시작 전후로 3D 트레이가 마운트되는
            크기가 바뀌지 않는다(물리 월드·WebGL 컨텍스트 재생성 위험을 구조적으로 피한다). */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-gutter">
          <div className="flex min-w-0 items-center gap-8">
            <QrFallback>
              <QRCodeSVG
                className="size-[clamp(13rem,26vh,20rem)] flex-none rounded-card bg-white p-3"
                level="M"
                marginSize={1}
                title={`방 ${roomSession.roomCode} 초대 QR 코드`}
                value={createInviteUrl(roomSession.roomCode, { party: true })}
              />
            </QrFallback>
            <div className="grid min-w-0 gap-2 text-left">
              <span className="font-mono text-[13px] font-bold tracking-[0.14em] text-content-muted uppercase">
                Room Code
              </span>
              <span className="block truncate font-mono text-[clamp(3rem,7vw,5.5rem)] leading-none font-bold tracking-[0.1em] tabular-nums">
                {roomSession.roomCode}
              </span>
              <p className="m-0 truncate font-mono text-[15px] text-content-muted">
                {createInviteUrl(roomSession.roomCode, { party: true })}
              </p>
            </div>
          </div>
          {/* 링크 복사·공유 버튼은 두지 않는다 — TV·모니터에서 클립보드도 navigator.share도
              쓸 데가 없다. QR과 큰 코드가 전달 수단 전부다. */}
          <p className="m-0 text-[15px] text-content-muted">폰으로 QR을 찍으면 바로 참여해요.</p>
        </div>

        {/* [굴리기]가 들어설 띠. 대시보드에는 누를 것이 없다 — 방장(처음 들어온 폰)이 시작한다.
            누를 수 없는 버튼을 회색으로 세워 두면 TV 앞 사람이 마우스를 찾아 헤매므로,
            버튼을 아예 두지 않고 누가 눌러야 하는지만 알린다. */}
        <footer className="flex flex-none items-center justify-center border-t border-border px-gutter py-4">
          <p className="m-0 text-center text-[15px] text-content-muted" role="status">
            {connectionStatus !== 'connected'
              ? '실시간 연결을 기다리고 있어요.'
              : host
                ? `${host.nickname} 님이 폰에서 게임을 시작할 수 있어요.`
                : '먼저 들어온 사람이 폰에서 게임을 시작할 수 있어요.'}
          </p>
        </footer>
      </div>

      {/* ScoreSheet가 들어설 열. 헤더 행 모양도 점수표와 같게 맞춘다. */}
      {wide && <ParticipantColumn capacity={capacity} hostId={hostId} players={players} />}
    </main>
  )
}

function ParticipantColumn({
  capacity,
  hostId,
  players,
}: {
  capacity: number
  hostId: PlayerId | undefined
  players: Player[]
}) {
  const emptySeats = Math.max(0, capacity - players.length)

  return (
    <section
      aria-label={`참가자 ${players.length}명`}
      className="flex min-h-0 flex-col border-l border-border"
    >
      <div className="flex flex-none items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
        <h2 className="m-0 text-[15px] font-bold tracking-[0.02em] whitespace-nowrap">참가자</h2>
        <p className="m-0 font-mono text-[12px] tabular-nums text-content-faint">
          {players.length} / {capacity}
        </p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min gap-2.5 overflow-y-auto px-3 pb-3">
        {players.map((player) => (
          <PlayerCard
            avatarSeed={player.playerId}
            key={player.playerId}
            name={player.nickname}
            status={player.status}
            subtitle={player.kind === 'BOT' ? '상태 기반 AI 봇' : undefined}
            // 방장 표시가 이 화면에서 정보인 이유: 시작 버튼이 이 화면에 없으므로, 누구 폰을
            // 봐야 하는지 알려주지 않으면 TV 앞 사람들이 서로를 쳐다보게 된다.
            trailing={
              player.playerId === hostId ? (
                <span className="rounded-[6px] bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] text-content-muted">
                  방장
                </span>
              ) : undefined
            }
          />
        ))}
        {players.length === 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-white/14 px-3 text-sm text-content-muted">
            아직 아무도 없어요 · QR을 찍어 주세요
          </p>
        )}
        {emptySeats > 0 && players.length > 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-white/14 px-3 text-sm text-content-muted tabular-nums">
            <span
              aria-hidden="true"
              className="size-11 flex-none rounded-card border border-dashed border-white/18"
            />
            빈 자리 {emptySeats}
          </p>
        )}
      </div>
    </section>
  )
}

/** 방을 여는 동안, 또는 열지 못했을 때. */
function PartyOpeningNotice({ error, onHome }: { error: Error | null; onHome: () => void }) {
  return (
    <main className="mx-auto flex h-svh w-full max-w-lg flex-col items-center justify-center gap-4 px-gutter text-center text-content">
      {error ? (
        <>
          <p className="m-0 text-[17px] font-bold" role="alert">
            파티 방을 열지 못했어요
          </p>
          <p className="m-0 text-sm text-content-muted">{error.message}</p>
          <Button onClick={onHome} variant="secondary">
            홈으로
          </Button>
        </>
      ) : (
        <p className="m-0 text-[15px] text-content-muted" role="status">
          파티 방을 열고 있어요.
        </p>
      )}
    </main>
  )
}

function connectionLabel(status: ReturnType<typeof useAppStore.getState>['connectionStatus']) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
