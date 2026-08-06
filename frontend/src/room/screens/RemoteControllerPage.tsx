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

/**
 * 로컬 게임의 폰 컨트롤러 — 큰 화면에서 도는 AI 대전을 이 폰으로 조작한다. (S15P11A406-215)
 *
 * <b>파티 모드 컨트롤러와 다른 점</b>: 저쪽은 서버가 경기를 돌려서 폰이 점수·상대·판정을
 * 스냅샷으로 받는다. 여기는 경기가 큰 화면 브라우저 안에서만 돌아 서버가 그 존재를 모르므로,
 * 이 폰이 받을 상태가 <b>없다</b>. 그래서 점수도 랠리도 그리지 않는다 — 없는 것을 그리려면
 * 큰 화면이 상태를 되쏘아 줘야 하고, 그건 조작 지연만 늘린다. 눈은 큰 화면에 두고 폰은
 * 보지 않고 휘두르는 물건이다.
 *
 * 방에 들어가는 이유는 하나뿐이다: 서버 릴레이(`sendPeerInput`)가 <b>같은 방 멤버십</b>을
 * 요구하기 때문이다. 게임은 시작하지 않으므로 서버 입장에선 그냥 사람 둘이 앉은 대기실이고,
 * 마지막 사람이 나가면 30초 뒤 자동으로 닫힌다.
 */

/** 눌렀을 때 손에 오는 짧은 확인. 큰 화면을 보고 있어 폰의 시각 반응은 눈에 안 들어온다. */
const TAP_VIBRATION = 12

interface RemoteControllerPageProps {
  /** 큰 화면의 playerId. QR에 실려 온다 — 대시보드는 명단에 없어 폰이 찾아낼 방법이 없다. */
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

  // 방에 붙는 것 말고는 할 일이 없으므로 닉네임을 묻지 않는다 — 이 이름을 볼 사람이 없다.
  // 이미 세션이 있으면(새로고침) 그대로 쓴다. 다시 join하면 방에 유령이 하나 더 생긴다.
  useEffect(() => {
    if (joined || joinRoom.isLoading || joinRoom.error) return
    void joinRoom.execute(roomCode, { nickname: '컨트롤러' })
  }, [joinRoom, joined, roomCode])

  const send = useRef<() => void>(() => {})
  send.current = () => {
    if (!joined) return
    vibrate(TAP_VIBRATION)
    sendPeerInput(client, hostPlayerId, { type: input } as PeerInput)
    // 눌린 것을 화면으로도 한 번 알린다 — 진동이 없는 기기(아이폰)에서는 이것만 남는다.
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
            <p className="mt-2 text-sm text-white/55">
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
          <span className="font-mono text-2xs tracking-[0.18em] text-white/40">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{joined ? '연결됨' : '연결하는 중…'}</strong>
        </div>
        <GameChromeButton onClick={() => void navigate({ to: '/' })}>나가기</GameChromeButton>
      </header>

      <button
        aria-label={touchOnly ? '화면을 눌러 조작' : '휴대폰을 휘둘러 조작'}
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-white/12 bg-[radial-gradient(circle_at_50%_45%,rgb(43_143_224_/_22%),transparent_58%)] active:bg-white/8 disabled:opacity-40"
        disabled={!joined}
        onPointerDown={(event) => {
          event.preventDefault()
          send.current()
        }}
        type="button"
      >
        {/* key가 바뀔 때마다 요소가 새로 붙어 애니메이션이 처음부터 다시 돈다 — 상태로
            "지금 튀는 중"을 들면 되돌릴 렌더가 없어 튄 채로 굳는다. */}
        <span
          aria-hidden="true"
          className="animate-pp-feedback-pop absolute top-[20%] left-1/2 block h-[40%] aspect-square -translate-x-1/2 rotate-[-8deg] rounded-full border-[10px] border-pp-side-blue/45 bg-pp-side-blue shadow-[0_18px_45px_rgb(43_143_224_/_35%)]"
          key={sentAt}
        />
        <span className="absolute inset-x-5 bottom-7 text-center text-base font-bold text-white/75">
          {joined ? swingHint(touchOnly) : '큰 화면과 잇는 중이에요'}
        </span>
      </button>

      <section className="mt-3 grid flex-none gap-2 text-center">
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-card border border-pp-accent/45 bg-pp-accent/12 px-5 font-bold text-pp-accent-text transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙 켜기
          </button>
        )}
        <p className="m-0 text-sm text-white/45" role="status">
          {connectionMessage(connectionStatus)}
        </p>
      </section>
    </ControllerScreen>
  )
}

/**
 * 소켓 상태를 사람 말로. 처음 붙는 중(`connecting`)과 <b>끊겼다 다시 붙는 중</b>
 * (`reconnecting`·`closed`)을 가른다 — 방금 QR을 찍고 들어온 사람에게 "연결이 불안정해요"는
 * 거짓말이고, 이 화면의 첫인상이 고장으로 남는다.
 */
function connectionMessage(status: ConnectionStatus) {
  if (status === 'connected') return '점수와 공은 큰 화면에서 보세요'
  if (status === 'reconnecting' || status === 'closed') return '연결이 끊겼어요 · 다시 잇는 중'
  return '큰 화면과 잇는 중이에요'
}

function swingHint(touchOnly: boolean) {
  return touchOnly ? '화면을 눌러 받아치기' : '폰을 라켓처럼 쥐고 휘두르세요'
}
