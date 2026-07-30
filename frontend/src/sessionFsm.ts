import type { RoomSnapshot } from '@/realtime/wsEvents'

/**
 * 세션 수명 유한 상태 장치(FSM). (S15P11A406-101)
 *
 * 상태는 store가 이미 들고 있는 (roomSession, roomSnapshot)에서 **파생**한다 —
 * 별도 상태를 저장하면 두 소스가 어긋나는 순간 유령 세션이 생기기 때문이다.
 *
 *   idle ──join 성공──▶ joining ──첫 snapshot──▶ inLobby ⇄ inGame ──▶ finished
 *     ▲                                                                │(재대결는 inGame으로)
 *     └────── leave 완료 · room.closed · 세션 만료 ────────────────────────┘
 *
 * 종료·중단 전이는 전부 store.endSession(reason) 한 곳으로 모은다. 재연결 포기는 토큰을
 * 지우지 않고 복귀 확인 상태로 멈추며, 나머지 이유만 idle로 끝난다.
 */

export type SessionPhase = 'idle' | 'joining' | 'inLobby' | 'inGame' | 'finished'

/** 세션을 끝내거나 복귀 확인 상태로 멈추는 이유. 사용자 안내 문구가 이유마다 다르다. */
export type SessionEndReason = 'left' | 'room_closed' | 'expired' | 'disconnected' | 'removed'

interface SessionLike {
  roomId: string
}

export function sessionPhaseOf(
  session: SessionLike | null,
  snapshot: RoomSnapshot | null,
): SessionPhase {
  if (!session) return 'idle'
  if (!snapshot || snapshot.roomId !== session.roomId) return 'joining'
  if (snapshot.phase === 'playing') return 'inGame'
  if (snapshot.phase === 'finished') return 'finished'
  return 'inLobby'
}

/** FSM 상태가 허용하는 화면. 상태↔URL 동기화 규칙은 여기 한 곳에만 둔다. */
export function sessionScreenOf(phase: SessionPhase): 'home' | 'lobby' | 'game' {
  if (phase === 'idle') return 'home'
  if (phase === 'inGame' || phase === 'finished') return 'game'
  return 'lobby'
}

export const sessionEndNotices: Record<SessionEndReason, string | null> = {
  left: null,
  room_closed: '방이 종료되어 홈으로 이동했어요.',
  expired: '입장 정보가 만료됐어요. 방에 다시 참가해 주세요.',
  disconnected: '연결이 계속 끊겼어요. 네트워크를 확인한 뒤 다시 연결해 주세요.',
  removed: '자리를 오래 비워 게임에서 나가게 됐어요. 게임이 끝나면 다시 참가할 수 있어요.',
}
