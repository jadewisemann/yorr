import { useChat } from '@/realtime/chat/ChatContext'
import { ChatDock } from '@/realtime/chat/ChatDock'
import { ChatPanel } from '@/realtime/chat/ChatPanel'
import {
  ControllerConnectSequence,
  controllerHowTo,
} from '@/room/components/ControllerConnectSequence'
import { InvitePopover } from '@/room/components/InvitePopover'
import { BotManagementPanel } from '@/room/components/Lobby/BotManagementPanel'
import { LobbyPlayerList, LobbyStartPanel } from '@/room/components/Lobby/LobbyRoomContent'
import { connectionLabel } from '@/room/domain/lobbyLabels'
import { useLobbyActions } from '@/room/model/useLobbyActions'
import { useLobbyChrome } from '@/room/model/useLobbyChrome'
import { useLobbyRoom } from '@/room/model/useLobbyRoom'
import { cn } from '@/shared/cn'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { AudioStatusIcon, audioLabel } from '@/shared/components/AudioStatusIcon'
import { Button } from '@/shared/components/Button'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { RoomExitGuard } from './RoomExitGuard'

interface LobbyPageProps {
  roomId: string
}

export function LobbyPage({ roomId }: LobbyPageProps) {
  const room = useLobbyRoom(roomId)
  const chrome = useLobbyChrome()
  const actions = useLobbyActions(room)
  const chat = useChat()

  const { connectionStatus, session, snapshot } = room
  const HowTo = controllerHowTo[room.gameCode]

  if (!session) return null

  return (
    <>
      <RoomExitGuard onClose={chrome.cancelExit} open={chrome.exitRequested} roomId={roomId} />
      <AudioPopover
        anchorRef={chrome.audio.buttonRef}
        muted={chrome.soundMuted}
        onClose={chrome.audio.close}
        onToggleMute={chrome.toggleMute}
        open={chrome.audio.open}
      />
      <InvitePopover
        anchorRef={chrome.invite.buttonRef}
        onClose={chrome.invite.close}
        open={chrome.invite.open}
        roomCode={session.roomCode}
      />
      <LoadingOverlay
        message="게임을 준비하고 있어요"
        open={Boolean(snapshot) && snapshot?.phase !== 'waiting'}
      />
      <main className="mx-auto flex h-svh w-full max-w-2xl flex-col gap-4 overflow-x-hidden px-gutter pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-content lg:max-w-5xl lg:flex-row lg:items-stretch lg:gap-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <header className="flex items-center gap-3 border-b border-border pb-3.5">
            <div className="grid min-w-0 flex-1 gap-1">
              <h1 className="m-0 text-lg font-bold">대기실</h1>
              <p className="m-0 flex items-center gap-2 text-xs text-content-muted">
                <span className="font-mono font-bold tracking-[0.12em] text-content">
                  {session.roomCode}
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
            <Button
              aria-label={audioLabel({ muted: chrome.soundMuted })}
              className="flex-none px-3 text-base"
              onClick={chrome.audio.show}
              ref={chrome.audio.buttonRef}
              type="button"
              variant="secondary"
            >
              <AudioStatusIcon muted={chrome.soundMuted} />
            </Button>
            <Button
              className="flex-none px-3.5 text-sm"
              onClick={chrome.requestExit}
              type="button"
              variant="danger"
            >
              나가기
            </Button>
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col gap-4">
            {/*
             * 좁은 화면의 채팅은 본문 **위에 떠 있다**(넓은 화면은 오른쪽 열 패널이 맡는다).
             * 폰 세로에서 채팅에 자리를 떼어 주면 참가자 목록과 시작 버튼이 그만큼 밀린다 —
             * 접힌 도크가 최근 몇 줄만 보여 주고, 펼치면 본문 위를 덮는다.
             */}
            <ChatDock
              chat={chat}
              className="absolute inset-x-0 top-0 z-sticky lg:hidden"
              onToggle={chrome.setChatOpen}
              open={chrome.chatOpen}
              you={session.you}
            />

            {/*
             * 대기실 본문은 **하나의 스크롤 영역**이다. 위쪽 `pt`(4.75rem)는 접힌 도크 세 줄이
             * 앉을 자리다 —
             * 목록만 따로 굴리게 두면 도크에 가린 채 시작 버튼까지 밀려난다.
             */}
            <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto overscroll-contain max-lg:pt-[4.75rem]">
              {room.controller && (
                <ControllerConnectSequence
                  howTo={HowTo ? <HowTo /> : undefined}
                  status={connectionStatus}
                />
              )}

              <BotManagementPanel
                adding={actions.addingBot}
                capacity={room.capacity}
                error={actions.botError}
                loading={actions.botLoading}
                onAdd={() => void actions.addBot()}
                playerCount={snapshot?.players.length ?? 0}
                visible={Boolean(snapshot && room.isHost && !room.duoGame)}
              />

              {!snapshot && !room.controller && (
                <p className="m-0 text-center text-sm text-content-muted" role="status">
                  실시간 대기실에 연결하고 있어요.
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">참가 인원</span>
                <span className="ml-auto font-mono text-base font-bold tabular-nums">
                  {snapshot?.players.length ?? 0}
                  <span className="text-content-faint"> / {room.capacity}</span>
                </span>
                {!room.controller && (
                  <Button
                    className="min-h-9 flex-none px-3 text-sm"
                    onClick={chrome.invite.show}
                    ref={chrome.invite.buttonRef}
                    type="button"
                    variant="secondary"
                  >
                    초대
                  </Button>
                )}
              </div>

              <LobbyPlayerList
                botLoading={actions.botLoading}
                capacity={room.capacity}
                isHost={room.isHost}
                onRemoveBot={actions.removeBot}
                snapshot={snapshot}
                you={session.you}
              />
            </div>

            <LobbyStartPanel
              canStart={room.canStart}
              connectionStatus={connectionStatus}
              isHost={room.isHost}
              minPlayers={room.minPlayers}
              onStart={() => void actions.start()}
              snapshot={snapshot}
              startError={actions.startError}
              startLoading={actions.startLoading}
            />
          </div>
        </div>

        <ChatPanel chat={chat} className="hidden lg:flex lg:w-80" you={session.you} />
      </main>
    </>
  )
}
