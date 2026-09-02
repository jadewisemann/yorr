import { waitingRoomSnapshot } from '@/mocks/fixtures'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'

/** 파티 모드 검사들이 함께 쓰는 두 사람. `playerOrder`의 순서가 로컬 1·2번을 정한다. */
export const P1 = 'player-1'
export const P2 = 'player-2'

export function pingPongState(overrides: Partial<PingPongState> = {}): PingPongState {
  return {
    ball: {
      direction: 1,
      faultFrom: 0,
      launchedAt: 0,
      pos: 0.5,
      smash: false,
      speed: 1,
      x0: 0.5,
      x1: 0.5,
    },
    lastInputSeq: { [P1]: 3, [P2]: 5 },
    nextActionAt: 0,
    phase: 'COUNTDOWN',
    playerOrder: [P1, P2],
    rally: 0,
    readyPlayerIds: [P1, P2],
    scores: { [P1]: 0, [P2]: 0 },
    version: 4,
    ...overrides,
  }
}

/**
 * 랠리가 한창인 판. 화면 검사 두 벌이 이 값을 바탕으로 자기 몫만 덮어쓴다.
 * 서버 계약의 `PingPongState` 그대로이므로 화면이 읽는 필드가 빠지면 여기서 드러난다.
 */
export function playingState(overrides: Partial<PingPongState> = {}): PingPongState {
  return {
    ball: {
      direction: 1,
      fault: null,
      faultFrom: 0,
      launchedAt: 1_000,
      pos: 0.5,
      smash: false,
      speed: 1.95,
      x0: 0.5,
      x1: 0.7,
    },
    lastEvent: null,
    lastInputSeq: { [P1]: 1, [P2]: 1 },
    nextActionAt: 2_000,
    phase: 'PLAYING',
    playerOrder: [P1, P2],
    readyPlayerIds: [P1, P2],
    rally: 2,
    scores: { [P1]: 3, [P2]: 2 },
    serveReceiverId: P1,
    version: 3,
    ...overrides,
  }
}

/** 그 판이 실린 방 스냅샷. 나(P1)와 상대(P2) 두 사람이 앉아 있다. */
export function playingSnapshot(game: PingPongState): RoomSnapshot {
  return {
    ...waitingRoomSnapshot,
    game,
    gameCode: 'PING_PONG',
    phase: 'playing',
    players: [
      { ...waitingRoomSnapshot.players[0], nickname: '나', playerId: P1 },
      { ...waitingRoomSnapshot.players[1], nickname: '상대', playerId: P2 },
    ],
  } as unknown as RoomSnapshot
}
