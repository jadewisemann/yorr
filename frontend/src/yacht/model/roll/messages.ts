import type { ErrorPayload, GameState, ServerMessage } from '@/realtime/wsEvents'

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>

/**
 * 서버가 보낸 굴림 메시지를 「지금 이 화면의 것인가」로 걸러 읽는다.
 *
 * 굴림 방송은 방 전체에 간다 — 지난 라운드의 것, 다른 사람 턴의 것이 섞여 도착하므로
 * 받자마자 반영하면 화면이 뒤로 돌아간다.
 */
export function isCurrentDiceBroadcast(
  message: DiceBroadcastMessage,
  roomId: string,
  game: GameState | undefined,
) {
  return (
    message.roomId === roomId &&
    message.payload.roundNumber === game?.roundNumber &&
    message.payload.playerId === game.activePlayerId
  )
}

/**
 * 렌더된 상태와 스토어의 상태 중 더 앞선 쪽. 메시지 핸들러는 렌더보다 먼저 도착할 수 있어서
 * 자기가 마지막으로 본 것만 믿으면 한 라운드 뒤처진 판단을 한다.
 */
export function latestGameState(
  rendered: GameState | undefined,
  stored: GameState | undefined,
): GameState | undefined {
  return stored && stored.roundNumber >= (rendered?.roundNumber ?? 0) ? stored : rendered
}

/** 내 차례가 아니라는 서버 거절은 사용자 말로 바꾼다 — 원문은 개발자용이다. */
export function turnAwareErrorMessage(payload: ErrorPayload): string {
  return payload.code === 'NOT_YOUR_TURN' ? '지금은 내 차례가 아니에요.' : payload.message
}
