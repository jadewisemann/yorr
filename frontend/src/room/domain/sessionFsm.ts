import type { RoomSnapshot } from '@/realtime/wsEvents'

export type SessionPhase = 'idle' | 'joining' | 'inLobby' | 'inGame' | 'finished'

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
