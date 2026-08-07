import type { ErrorPayload, GameState, ServerMessage } from '@/realtime/wsEvents'

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>

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

export function latestGameState(
  rendered: GameState | undefined,
  stored: GameState | undefined,
): GameState | undefined {
  return stored && stored.roundNumber >= (rendered?.roundNumber ?? 0) ? stored : rendered
}

export function turnAwareErrorMessage(payload: ErrorPayload): string {
  return payload.code === 'NOT_YOUR_TURN' ? '지금은 내 차례가 아니에요.' : payload.message
}
