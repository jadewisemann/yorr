import type { ControllerLinkRole } from '@/realtime/controllerLink/controllerLink'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { useAppStore } from '@/store'

/**
 * 이 기기가 컨트롤러 링크에서 맡을 역할. `null`이면 링크를 만들지 않는다.
 *
 * 판정이 `realtime/`이 아니라 여기 있는 이유: 링크의 존재 조건은 **파티 방인가**이고,
 * 그것을 아는 것은 `room/`이다(서버 스냅샷에 방 모드가 없어서 폰이 `yorr.party-room`에
 * 기억한다 — room-and-session.md 「파티 모드」). `realtime/`은 경계 모듈이라 방 도메인을
 * 되돌아 참조하지 않는다.
 *
 * 화면 폭은 보지 않는다. `GamePlay`의 컨트롤러 분기와 달리 링크는 회전 한 번에
 * 끊고 다시 붙일 대상이 아니고, 파티 방의 게임판은 정의상 대시보드다.
 */
export function useControllerLinkRole(): ControllerLinkRole | null {
  const membershipRole = useAppStore((state) => state.roomSession?.membershipRole)
  const roomCode = useAppStore((state) => state.roomSession?.roomCode)

  if (membershipRole === 'dashboard') return 'dashboard'
  return isPartyRoom(roomCode) ? 'controller' : null
}
