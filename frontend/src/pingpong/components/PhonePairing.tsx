import { QRCodeSVG } from 'qrcode.react'
import { useEffect } from 'react'
import { useCreatePartyRoom } from '@/room/api/useRoomApi'
import { QrFallback } from '@/room/components/InvitePopover'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { useAppStore } from '@/store'

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
          <p className="mt-1.5 mb-0 text-sm text-game-content-muted">
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
            <p className="m-0 font-mono text-xs tracking-[0.18em] text-game-content-faint">
              {roomSession.roomCode}
            </p>
          </>
        ) : (
          <p className="m-0 py-10 text-sm text-game-content-muted" role="status">
            {createParty.error ? '연결을 준비하지 못했어요' : '연결을 준비하는 중…'}
          </p>
        )}

        <p className="m-0 text-xs text-game-content-faint" role="status">
          {connectionStatus === 'connected' && paired ? '폰이 붙으면 바로 휘두를 수 있어요' : ' '}
        </p>

        <GameChromeButton onClick={onClose}>닫기</GameChromeButton>
      </section>
    </div>
  )
}

function controllerUrl(roomCode: string, hostPlayerId: string) {
  const origin = typeof window === 'undefined' ? 'https://yorr.invalid' : window.location.origin
  return `${origin}/controller?code=${encodeURIComponent(roomCode)}&to=${encodeURIComponent(hostPlayerId)}&input=SWING`
}
