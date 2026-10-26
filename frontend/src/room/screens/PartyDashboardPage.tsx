import { useNavigate } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect } from 'react'
import { type GameKey, gameByKey } from '@/games'
import { useCreatePartyRoom } from '@/room/api/useRoomApi'
import { createInviteUrl, QrFallback } from '@/room/components/InvitePopover'
import { ParticipantColumn } from '@/room/components/PartyDashboard/ParticipantColumn'
import { RoomCodeStatus } from '@/room/components/RoomCodeStatus'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { Button } from '@/shared/components/Button'
import { PlayBoard } from '@/shared/components/Screen'
import { useWideLayout } from '@/shared/useWideLayout'
import { useAppStore } from '@/store'
import { PartyOpeningNotice } from './PartyOpeningNotice'

export type PartyGameKey = GameKey

type ConnectionStatus = ReturnType<typeof useAppStore.getState>['connectionStatus']
type Player = NonNullable<
  ReturnType<typeof useAppStore.getState>['roomSnapshot']
>['players'][number]

/**
 * 대시보드 방을 열고, 열린 방이 게임을 시작하면 게임 화면으로 넘어간다. 배경음은 고른
 * 게임의 것을 튼다.
 */
function usePartyRoom(gameKey: PartyGameKey) {
  const navigate = useNavigate()
  const game = gameByKey(gameKey)
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const createParty = useCreatePartyRoom()
  const isDashboard = roomSession?.membershipRole === 'dashboard'

  useEffect(() => {
    if (isDashboard || createParty.isLoading || createParty.error) return
    if (game.gameCode) void createParty.execute(game.gameCode)
  }, [createParty, game.gameCode, isDashboard])

  useEffect(() => playLandingSoundtrack(gameKey), [gameKey])

  useEffect(() => {
    if (!isDashboard || !roomSession || !roomSnapshot || roomSnapshot.phase === 'waiting') return
    void navigate({
      to: '/rooms/$roomId/game',
      params: { roomId: roomSession.roomId },
      replace: true,
    })
  }, [isDashboard, navigate, roomSession, roomSnapshot])

  return { createParty, game, isDashboard, navigate, roomSession, roomSnapshot }
}

function partyStatusMessage(connectionStatus: ConnectionStatus, host: Player | undefined) {
  if (connectionStatus !== 'connected') return '실시간 연결을 기다리고 있어요.'
  if (host) return `${host.nickname} 님이 폰에서 게임을 시작할 수 있어요.`
  return '먼저 들어온 사람이 폰에서 게임을 시작할 수 있어요.'
}

/** 큰 화면 가운데의 초대 — QR과 방 코드, 링크. */
function PartyInvite({ roomCode }: { roomCode: string }) {
  const inviteUrl = createInviteUrl(roomCode, { party: true })
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-gutter">
      <div className="flex min-w-0 items-center gap-6">
        <QrFallback>
          {/* 순백 고정 — QR 정숙 구역. 테마를 따라가지 않는다(InvitePopover와 같은 이유). */}
          <QRCodeSVG
            className="size-[clamp(13rem,26vh,20rem)] flex-none rounded-card bg-white p-3"
            level="M"
            marginSize={1}
            title={`방 ${roomCode} 초대 QR 코드`}
            value={inviteUrl}
          />
        </QrFallback>
        <div className="grid min-w-0 gap-2 text-left">
          <span className="font-mono text-xs font-bold tracking-[0.14em] text-content-muted uppercase">
            Room Code
          </span>
          <span className="block truncate font-mono text-[clamp(3rem,7vw,5.5rem)] leading-none font-bold tracking-[0.1em] tabular-nums">
            {roomCode}
          </span>
          <p className="m-0 truncate font-mono text-sm text-content-muted">{inviteUrl}</p>
        </div>
      </div>
      <p className="m-0 text-sm text-content-muted">폰으로 QR을 찍으면 바로 참여해요.</p>
    </div>
  )
}

export function PartyDashboardPage({ gameKey }: { gameKey: PartyGameKey }) {
  const wide = useWideLayout()
  const { createParty, game, isDashboard, navigate, roomSession, roomSnapshot } =
    usePartyRoom(gameKey)
  const connectionStatus = useAppStore((state) => state.connectionStatus)

  const capacity = roomSnapshot?.capacity ?? 6
  const players = roomSnapshot?.players ?? []
  const hostId = roomSnapshot?.hostId

  if (!isDashboard || !roomSession) {
    return (
      <PartyOpeningNotice error={createParty.error} onHome={() => void navigate({ to: '/' })} />
    )
  }

  const host = players.find((player) => player.playerId === hostId)

  return (
    <PlayBoard wide={wide}>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-none items-center gap-3 border-b border-border px-gutter py-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 text-lg font-bold">파티 모드 · {game.name}</h1>
            <RoomCodeStatus connectionStatus={connectionStatus} roomCode={roomSession.roomCode} />
          </div>
          <Button
            className="flex-none px-3.5 text-sm"
            onClick={() => void navigate({ to: '/' })}
            type="button"
            variant="danger"
          >
            방 닫기
          </Button>
        </header>

        <p className="m-0 flex flex-none items-center gap-2 border-b border-border px-gutter py-2.5 text-xs text-content-muted">
          참가자 {players.length}명
          <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
          최대 {capacity}명
        </p>

        <PartyInvite roomCode={roomSession.roomCode} />

        <footer className="flex flex-none items-center justify-center border-t border-border px-gutter py-4">
          <p className="m-0 text-center text-sm text-content-muted" role="status">
            {partyStatusMessage(connectionStatus, host)}
          </p>
        </footer>
      </div>

      {wide && <ParticipantColumn capacity={capacity} hostId={hostId} players={players} />}
    </PlayBoard>
  )
}
