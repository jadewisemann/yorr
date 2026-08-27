import { useChat } from '@/realtime/chat/ChatContext'
import { ChatDialog, ChatUnreadBadge, chatLabel } from '@/realtime/chat/ChatDialog'
import {
  ControllerConnectSequence,
  controllerHowTo,
} from '@/room/components/ControllerConnectSequence'
import { InvitePopover } from '@/room/components/InvitePopover'
import { BotManagementPanel } from '@/room/components/Lobby/BotManagementPanel'
import { LobbyRoomContent } from '@/room/components/Lobby/LobbyRoomContent'
import { connectionLabel } from '@/room/domain/lobbyLabels'
import { useLobbyActions } from '@/room/model/useLobbyActions'
import { useLobbyChrome } from '@/room/model/useLobbyChrome'
import { useLobbyRoom } from '@/room/model/useLobbyRoom'
import { cn } from '@/shared/cn'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { AudioStatusIcon, audioLabel } from '@/shared/components/AudioStatusIcon'
import { Button } from '@/shared/components/Button'
import { IconChat } from '@/shared/components/Icon'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useWideLayout } from '@/shared/useWideLayout'
import { RoomExitGuard } from './RoomExitGuard'

interface LobbyPageProps {
  roomId: string
}

export function LobbyPage({ roomId }: LobbyPageProps) {
  const room = useLobbyRoom(roomId)
  const chrome = useLobbyChrome()
  const actions = useLobbyActions(room)
  const chat = useChat()
  const wide = useWideLayout()

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
      <ChatDialog
        anchorRef={chrome.chat.buttonRef}
        chat={chat}
        layout={wide ? 'wide' : 'narrow'}
        onClose={chrome.chat.close}
        open={chrome.chat.open}
        you={session.you}
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
      <main className="mx-auto flex h-svh w-full max-w-2xl flex-col gap-4 overflow-x-hidden px-gutter pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-content">
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
            aria-label={chatLabel(chat.unread)}
            className={cn('relative flex-none px-3 text-base', chat.unread > 0 && 'border-brand')}
            onClick={chrome.chat.show}
            ref={chrome.chat.buttonRef}
            type="button"
            variant="secondary"
          >
            <IconChat className="size-4.5" />
            <ChatUnreadBadge count={chat.unread} />
          </Button>
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

        <div className="flex flex-none items-center justify-between gap-3">
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

        <LobbyRoomContent
          botLoading={actions.botLoading}
          canStart={room.canStart}
          capacity={room.capacity}
          connectionStatus={connectionStatus}
          isHost={room.isHost}
          minPlayers={room.minPlayers}
          onRemoveBot={actions.removeBot}
          onStart={() => void actions.start()}
          snapshot={snapshot}
          startError={actions.startError}
          startLoading={actions.startLoading}
          you={session.you}
        />
      </main>
    </>
  )
}
