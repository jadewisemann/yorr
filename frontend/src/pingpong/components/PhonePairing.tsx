import { QRCodeSVG } from 'qrcode.react'
import { useEffect } from 'react'
import { useCreatePartyRoom } from '@/room/api/useRoomApi'
import { QrFallback } from '@/room/components/InvitePopover'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { useAppStore } from '@/store'

/**
 * 큰 화면에서 AI 대전을 하면서 폰을 컨트롤러로 붙이는 QR. (S15P11A406-215)
 *
 * <b>방을 왜 여는가.</b> 경기는 이 브라우저 안에서 다 돈다 — 서버는 이 판을 모른다. 방은
 * 오로지 폰이 보낸 스윙을 여기까지 배달받기 위한 것이다(`peerInput`의 릴레이가 같은 방
 * 멤버십을 요구한다). 그래서 게임을 시작하지 않고, 서버 입장에선 사람 둘이 앉은 대기실이다.
 *
 * <b>버튼을 눌러야 열린다.</b> AI 모드에 들어올 때마다 방을 열면 혼자 하는 대부분의 판이
 * 쓰지도 않을 방을 만든다. 빈 방은 30초 뒤 서버가 닫지만, 만들지 않는 편이 낫다.
 *
 * 대시보드 역할로 들어가므로 이름을 묻지 않는다. 그 대신 이쪽은 `RoomSnapshot.players`에
 * 없어서 폰이 주소를 찾을 수 없다 — 그래서 내 playerId를 QR에 실어 보낸다.
 */
export function PhonePairing({ onClose }: { onClose: () => void }) {
  const createParty = useCreatePartyRoom()
  const roomSession = useAppStore((state) => state.roomSession)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const paired = roomSession?.membershipRole === 'dashboard'

  useEffect(() => {
    if (paired || createParty.isLoading || createParty.error) return
    void createParty.execute('PING_PONG')
  }, [createParty, paired])

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/70 px-5 backdrop-blur-sm">
      <section className="grid w-full max-w-sm gap-4 rounded-sheet border border-white/15 bg-pp-surface p-6 text-center shadow-2xl">
        <div>
          <h2 className="m-0 text-xl font-black">폰을 컨트롤러로</h2>
          <p className="mt-1.5 mb-0 text-sm text-white/55">
            폰으로 QR을 찍으면 이 화면을 보면서 폰을 휘둘러 받아칠 수 있어요.
          </p>
        </div>

        {paired && roomSession ? (
          <>
            <div className="mx-auto rounded-card bg-white p-3">
              <QrFallback>
                <QRCodeSVG
                  size={168}
                  title="폰 컨트롤러 연결 QR 코드"
                  value={controllerUrl(roomSession.roomCode, roomSession.you)}
                />
              </QrFallback>
            </div>
            <p className="m-0 font-mono text-xs tracking-[0.18em] text-white/45">
              {roomSession.roomCode}
            </p>
          </>
        ) : (
          <p className="m-0 py-10 text-sm text-white/55" role="status">
            {createParty.error ? '연결을 준비하지 못했어요' : '연결을 준비하는 중…'}
          </p>
        )}

        <p className="m-0 text-xs text-white/40" role="status">
          {connectionStatus === 'connected' && paired ? '폰이 붙으면 바로 휘두를 수 있어요' : ' '}
        </p>

        <GameChromeButton onClick={onClose}>닫기</GameChromeButton>
      </section>
    </div>
  )
}

/**
 * 폰이 찍고 갈 주소. `/join`이 아니라 `/controller`인 이유는 라우터 쪽 주석에 있다 —
 * 이 방은 서버 게임을 시작하지 않아서 대기실로 보내면 폰이 영원히 기다린다.
 */
function controllerUrl(roomCode: string, hostPlayerId: string) {
  const origin = typeof window === 'undefined' ? 'https://yorr.invalid' : window.location.origin
  return `${origin}/controller?code=${encodeURIComponent(roomCode)}&to=${encodeURIComponent(hostPlayerId)}&input=SWING`
}
