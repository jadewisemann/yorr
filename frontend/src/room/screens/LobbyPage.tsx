import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { gameByCode } from '@/games'
import { useVoice } from '@/realtime/voice/VoiceContext'
import { isRoomHost } from '@/room/api/roomApi'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'
import {
  ControllerConnectSequence,
  controllerHowTo,
} from '@/room/components/ControllerConnectSequence'
import { InvitePopover } from '@/room/components/InvitePopover'
import { BotManagementPanel } from '@/room/components/Lobby/BotManagementPanel'
import { LobbyRoomContent } from '@/room/components/Lobby/LobbyRoomContent'
import { connectionLabel, isDuoGame } from '@/room/domain/lobbyLabels'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
import { cn } from '@/shared/cn'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { Button } from '@/shared/components/Button'
import { IconMic, IconSound } from '@/shared/components/Icon'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useAppStore } from '@/store'
import { RoomExitGuard } from './RoomExitGuard'

const PREFETCH_FALLBACK_DELAY_MS = 500

function schedulePhysicsDicePrefetch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const prefetch = () => {
    void import('@/yacht/prefetchPhysicsDice').then(({ prefetchPhysicsDice }) =>
      prefetchPhysicsDice(),
    )
  }
  const idleApi = window as unknown as {
    requestIdleCallback?: Window['requestIdleCallback']
    cancelIdleCallback?: Window['cancelIdleCallback']
  }
  if (idleApi.requestIdleCallback && idleApi.cancelIdleCallback) {
    const idleId = idleApi.requestIdleCallback(prefetch, { timeout: 2_000 })
    return () => idleApi.cancelIdleCallback?.(idleId)
  }
  const timeoutId = window.setTimeout(prefetch, PREFETCH_FALLBACK_DELAY_MS)
  return () => window.clearTimeout(timeoutId)
}

interface LobbyPageProps {
  roomId: string
}

export function LobbyPage({ roomId }: LobbyPageProps) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const startGame = useStartGame()
  const addBot = useAddBot()
  const removeBot = useRemoveBot()
  // 통화 자체는 라우터 위 VoiceProvider가 들고 있다 — 여기서는 상태만 읽는다.
  const voice = useVoice()
  const [audioOpen, setAudioOpen] = useState(false)
  // 오디오 말풍선이 붙을 자리 — 헤더의 소리 버튼이다.
  const audioButtonRef = useRef<HTMLButtonElement>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  // 초대 말풍선이 붙을 자리 — 참가 인원 줄의 초대 버튼이다.
  const inviteButtonRef = useRef<HTMLButtonElement>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const [exitRequested, setExitRequested] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && isRoomHost(roomSnapshot, roomSession.you)
  const capacity = roomSnapshot?.capacity ?? 6
  const duoGame =
    isDuoGame(roomSnapshot?.gameCode) || (matchingRoom && isDuoGame(roomSession?.gameCode))
  const minPlayersToStart = duoGame ? 2 : 1
  const botMutationLoading = addBot.isLoading || removeBot.isLoading
  // 파티 모드 QR로 들어온 폰. 초대 패널을 세울 자리에 연결 안내가 대신 선다 —
  // QR·링크는 큰 화면이 이미 띄우고 있어서 여기 또 있으면 자기 폰을 자기가 찍게 된다.
  const controller = matchingRoom && isPartyRoom(roomSession.roomCode)
  const HowTo = controllerHowTo[roomSnapshot?.gameCode ?? roomSession?.gameCode ?? 'YACHT_DICE']
  const botMutationError = addBot.error ?? removeBot.error
  const canStart =
    isHost &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= minPlayersToStart

  useEffect(() => {
    if (roomSnapshot?.phase === 'waiting') {
      playLandingSoundtrack(gameByCode(roomSnapshot.gameCode).key)
    }
    if (!roomSession || !matchingRoom || roomResumeReason) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot && roomSnapshot.phase !== 'waiting') {
      void navigate({
        to: '/rooms/$roomId/game',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  useEffect(() => {
    if (!matchingRoom || roomSnapshot?.phase !== 'waiting' || duoGame) return
    return schedulePhysicsDicePrefetch()
  }, [duoGame, matchingRoom, roomSnapshot?.phase])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute()
  }

  const handleAddBot = async () => {
    if (!isHost || !roomSnapshot || roomSnapshot.players.length >= capacity) return
    await addBot.execute()
  }

  if (!roomSession || !matchingRoom || roomResumeReason) return null

  return (
    <>
      {/* 다이얼로그는 main 밖에 둔다 — Modal이 main에 inert를 걸어 안에 있으면
          모달 자신까지 클릭이 막힌다(GamePage·GameResult와 같은 배치). */}
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      <AudioPopover
        anchorRef={audioButtonRef}
        microphone={
          voice.status === 'unsupported'
            ? undefined
            : {
                connectedPeers: voice.peers.length,
                denied: voice.status === 'denied',
                on: voice.status === 'on',
                onToggle: voice.toggle,
                requesting: voice.status === 'requesting',
              }
        }
        muted={soundMuted}
        onClose={() => setAudioOpen(false)}
        onToggleMute={() => {
          const muted = !soundMuted
          setSoundMuted(muted)
          saveSoundMuted(muted)
          setSoundtrackMuted(muted)
        }}
        open={audioOpen}
      />
      <InvitePopover
        anchorRef={inviteButtonRef}
        onClose={() => setInviteOpen(false)}
        open={inviteOpen}
        roomCode={roomSession.roomCode}
      />
      {/* phase가 waiting을 벗어난 순간부터 게임 화면으로 옮겨질 때까지 덮는다. 호스트의
          "눌렀다"와 참가자의 "호스트가 시작했다"가 같은 신호라 조건이 하나로 끝난다 —
          참가자는 예전에 아무 예고 없이 화면이 바뀌었다. */}
      <LoadingOverlay
        message="게임을 준비하고 있어요"
        open={Boolean(roomSnapshot) && roomSnapshot?.phase !== 'waiting'}
      />
      {/* 뷰포트 높이로 프레임을 고정한다 — 참가자가 많아져도 스크롤은 아래 목록 안에서만
          일어난다(QA FND-6, GamePlay와 같은 패턴).

          overflow-hidden이 아니라 overflow-x-hidden이다(세로는 auto로 계산된다). 320×568(지원
          하한 기기)에서는 QR·봇 패널·시작 버튼이 높이를 다 먹어 flex-1인 참가자 목록이 4px로
          짜부라졌다 — 목록에 하한(min-h)을 주면 내용이 프레임을 넘는데, 감춰 버리면 시작 버튼이
          닿지 않는 곳으로 사라진다. 프레임 안에서 스크롤되게 두면 둘 다 산다.
          가장 컸던 초대 카드(QR)는 참가 인원 줄의 초대 버튼 + 말풍선으로 옮겼다
          (S15P11A406-203) — 여기 있는 것들은 대기실에서 계속 봐야 하는 것만 남았다.
          <b>문서 높이(min-h-svh)로 늘리지 않는 이유:</b> 이 앱의 모든 화면은 정확히 한
          뷰포트를 프레임으로 잡는다(GamePlay의 3D 트레이는 그 프레임에 맞춰 크기를 잡는다).
          문서가 자라는 화면을 하나만 섞으면 화면마다 스크롤 주체가 달라진다. */}
      <main className="mx-auto flex h-svh w-full max-w-2xl flex-col gap-5 overflow-x-hidden px-gutter pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-content">
        {/* 디자인 03 헤더 — 좌측 타이틀·코드·연결 상태, 우측 나가기. */}
        <header className="flex items-center gap-3 border-b border-border pb-3.5">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 text-lg font-bold">대기실</h1>
            <p className="m-0 flex items-center gap-2 text-xs text-content-muted">
              <span className="font-mono font-bold tracking-[0.12em] text-content">
                {roomSession.roomCode}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
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
          {/* 게임 시작 전에 마이크 권한을 끝내두게 여기에 둔다 — 시작 직후에 권한 창이 뜨면
              첫 턴을 놓친다. 켠 통화는 게임 화면으로 그대로 이어진다(VoiceProvider가 라우터 위).
              게임 화면과 같은 입구(오디오 말풍선)를 쓴다. */}
          <Button
            aria-label={
              voice.status === 'on'
                ? `오디오 설정 · 마이크 켜짐${voice.peers.length > 0 ? ` · ${voice.peers.length}명 연결됨` : ''}`
                : '오디오 설정 · 마이크 꺼짐'
            }
            className={cn('flex-none px-3 text-base', voice.status === 'on' && 'border-brand')}
            onClick={() => setAudioOpen(true)}
            ref={audioButtonRef}
            type="button"
            variant="secondary"
          >
            {/* 게임 헤더의 오디오 버튼과 같은 조합이다 — 소리 아이콘 + 통화 중일 때 마이크 배지.
                두 화면이 같은 것을 다른 그림으로 말하면 같은 버튼으로 읽히지 않는다. */}
            <span className="relative">
              <IconSound className="size-4.5" muted={soundMuted} />
              {voice.status === 'on' && (
                <IconMic className="absolute -top-1.5 -right-2 size-3 text-positive" />
              )}
            </span>
          </Button>
          <Button
            className="flex-none px-3.5 text-sm"
            onClick={() => setExitRequested(true)}
            type="button"
            variant="danger"
          >
            나가기
          </Button>
        </header>

        {/* 컨트롤러 자리에는 연결 안내만 선다(S15P11A406-205). 초대 입구는 아래 참가 인원 줄로
            옮겼고, 컨트롤러에게는 그 버튼도 주지 않는다 — 큰 화면이 이미 QR을 띄우고 있어서
            자기 폰으로 자기 QR을 찍는 길이 된다. */}
        {controller && (
          <ControllerConnectSequence
            howTo={HowTo ? <HowTo /> : undefined}
            status={connectionStatus}
          />
        )}

        <BotManagementPanel
          adding={addBot.isLoading}
          capacity={capacity}
          error={botMutationError}
          loading={botMutationLoading}
          onAdd={() => void handleAddBot()}
          playerCount={roomSnapshot?.players.length ?? 0}
          visible={Boolean(roomSnapshot && isHost && !duoGame)}
        />

        {/* 컨트롤러는 위 연결 안내가 같은 말을 이미 하고 있다 — 두 줄이 겹치면
            어느 쪽이 지금 상태인지 알 수 없다. */}
        {!roomSnapshot && !controller && (
          <p className="m-0 text-center text-sm text-content-muted" role="status">
            실시간 대기실에 연결하고 있어요.
          </p>
        )}

        {/* 초대 버튼은 이미 있던 줄에 얹는다 — 세로를 되찾으려고 초대 카드를 치운 자리에 새 줄을
            만들면 도로 같은 높이를 쓴다. 인원 수를 보고 "아직 덜 모였다"고 느끼는 자리가 초대를
            누르는 자리이기도 하다. 스냅샷을 기다리는 동안에도 그린다 — 방을 만든 직후가 초대
            링크를 뿌리는 순간인데 그때 버튼이 없으면 옮긴 의미가 없다. */}
        <div className="flex flex-none items-center justify-between gap-3">
          <span className="text-sm font-semibold">참가 인원</span>
          <span className="ml-auto font-mono text-base font-bold tabular-nums">
            {roomSnapshot?.players.length ?? 0}
            <span className="text-content-faint"> / {capacity}</span>
          </span>
          {!controller && (
            <Button
              className="min-h-9 flex-none px-3 text-sm"
              onClick={() => setInviteOpen(true)}
              ref={inviteButtonRef}
              type="button"
              variant="secondary"
            >
              초대
            </Button>
          )}
        </div>

        <LobbyRoomContent
          botLoading={botMutationLoading}
          canStart={canStart}
          capacity={capacity}
          connectionStatus={connectionStatus}
          isHost={isHost}
          minPlayers={minPlayersToStart}
          onRemoveBot={(playerId) => void removeBot.execute(playerId)}
          onStart={() => void handleStart()}
          snapshot={roomSnapshot}
          voice={voice}
          startError={startGame.error}
          startLoading={startGame.isLoading}
          you={roomSession.you}
        />
      </main>
    </>
  )
}
