import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { sendPeerInput } from '@/realtime/peerInput'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { PeerInput, PlayerId } from '@/realtime/wsEvents'
import { useJoinRoom } from '@/room/api/useRoomApi'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { ControllerScreen } from '@/shared/components/Screen'
import { useSwing } from '@/shared/useSwing'
import { vibrate } from '@/shared/vibrate'
import { type ConnectionStatus, useAppStore } from '@/store'

const TAP_VIBRATION = 12

interface RemoteControllerPageProps {
  hostPlayerId: PlayerId
  input: PeerInput['type']
  roomCode: string
}

export function RemoteControllerPage({ hostPlayerId, input, roomCode }: RemoteControllerPageProps) {
  const navigate = useNavigate()
  const client = useRealtimeClient()
  const joinRoom = useJoinRoom()
  const roomSession = useAppStore((state) => state.roomSession)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const [sentAt, setSentAt] = useState(0)
  const joined = roomSession?.roomId !== undefined

  useEffect(() => {
    if (joined || joinRoom.isLoading || joinRoom.error) return
    void joinRoom.execute(roomCode, { nickname: '컨트롤러' })
  }, [joinRoom, joined, roomCode])

  const send = useRef<() => void>(() => {})
  send.current = () => {
    if (!joined) return
    vibrate(TAP_VIBRATION)
    sendPeerInput(client, hostPlayerId, { type: input } as PeerInput)
    setSentAt(Date.now())
  }

  const { permission, requestPermission } = useSwing({
    enabled: joined,
    onSwing: () => send.current(),
  })
  const touchOnly = permission === 'denied' || permission === 'unsupported'

  if (joinRoom.error) {
    return (
      <ControllerScreen className="bg-pp-canvas">
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <h1 className="m-0 text-xl font-black">연결하지 못했어요</h1>
            <p className="mt-2 text-sm text-game-content-muted">
              큰 화면의 QR을 다시 찍어 주세요. 방이 닫혔을 수 있어요.
            </p>
            <GameChromeButton className="mt-4" onClick={() => void navigate({ to: '/' })}>
              처음으로
            </GameChromeButton>
          </div>
        </div>
      </ControllerScreen>
    )
  }

  return (
    <ControllerScreen className="bg-pp-canvas">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-2xs tracking-[0.18em] text-game-content-faint">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{joined ? '연결됨' : '연결하는 중…'}</strong>
        </div>
        <GameChromeButton onClick={() => void navigate({ to: '/' })}>나가기</GameChromeButton>
      </header>

      <button
        aria-label={touchOnly ? '화면을 눌러 조작' : '휴대폰을 휘둘러 조작'}
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-border-raised bg-[radial-gradient(circle_at_50%_45%,rgb(43_143_224_/_22%),transparent_58%)] active:bg-surface-veil disabled:opacity-40"
        disabled={!joined}
        onPointerDown={(event) => {
          event.preventDefault()
          send.current()
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className="animate-pp-feedback-pop absolute top-[20%] left-1/2 block h-[40%] aspect-square -translate-x-1/2 rotate-[-8deg] rounded-full border-[10px] border-pp-side-blue/45 bg-pp-side-blue shadow-[0_18px_45px_rgb(43_143_224_/_35%)]"
          key={sentAt}
        />
        <span className="absolute inset-x-5 bottom-7 text-center text-base font-bold text-game-content">
          {joined ? swingHint(touchOnly) : '큰 화면과 잇는 중이에요'}
        </span>
      </button>

      <section className="mt-3 grid flex-none gap-2 text-center">
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-card border border-pp-accent/45 bg-pp-accent/12 px-5 font-bold text-pp-accent-text transition-[scale] duration-150 focus-ring pressable"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙 켜기
          </button>
        )}
        <p className="m-0 text-sm text-game-content-faint" role="status">
          {connectionMessage(connectionStatus)}
        </p>
      </section>
    </ControllerScreen>
  )
}

function connectionMessage(status: ConnectionStatus) {
  if (status === 'connected') return '점수와 공은 큰 화면에서 보세요'
  if (status === 'reconnecting' || status === 'closed') return '연결이 끊겼어요 · 다시 잇는 중'
  return '큰 화면과 잇는 중이에요'
}

function swingHint(touchOnly: boolean) {
  return touchOnly ? '화면을 눌러 받아치기' : '폰을 라켓처럼 쥐고 휘두르세요'
}
