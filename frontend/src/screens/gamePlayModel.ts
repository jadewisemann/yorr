import type { DiceSet } from '@/domain/dice'
import { YACHT_CATEGORIES, type YachtCategory } from '@/domain/scoring'
import type {
  ErrorPayload,
  GameState,
  Player,
  PlayerId,
  ScoreBoard,
  ServerMessage,
} from '@/realtime/wsEvents'
import { isRecorded } from '@/yachtCategoryView'

export type RollInputMode = 'motion' | 'tap'
export type RollAnimationMode = RollInputMode | 'remote' | 'auto'

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'dice.broadcast' }>

/** 같은 서버 굴림을 받은 모든 클라이언트가 같은 물리 난수열을 쓰게 하는 32비트 FNV-1a. */
export function animationSeedForRoll(
  roomId: string,
  playerId: string,
  roundNumber: number,
  rollCount: number,
  dice: DiceSet,
) {
  const key = `${roomId}:${playerId}:${roundNumber}:${rollCount}:${dice.join('')}`
  let hash = 2_166_136_261
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619)
  }
  return hash >>> 0
}

export function latestGameState(
  rendered: GameState | undefined,
  stored: GameState | undefined,
): GameState | undefined {
  return stored && stored.roundNumber >= (rendered?.roundNumber ?? 0) ? stored : rendered
}

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

export function rollAnimationMode({
  forced,
  ownRoll,
  pendingInputMode,
}: {
  forced: boolean
  ownRoll: boolean
  pendingInputMode: RollInputMode | null
}): RollAnimationMode {
  if (forced) return 'auto'
  if (pendingInputMode) return pendingInputMode
  return ownRoll ? 'tap' : 'remote'
}

export function turnAwareErrorMessage(payload: ErrorPayload): string {
  return payload.code === 'NOT_YOUR_TURN' ? '지금은 내 차례가 아니에요.' : payload.message
}

/** 두 점수판을 비교해 이번에 새로 채워진 족보 하나를 찾는다. 없으면 null. */
export function newlyRecordedCategory(
  previous: ScoreBoard | undefined,
  next: ScoreBoard,
): [YachtCategory, number] | null {
  for (const category of YACHT_CATEGORIES) {
    const after = next.categories[category]
    if (after !== null && after !== undefined && !isRecorded(previous?.categories[category])) {
      return [category, after]
    }
  }
  return null
}

/** 서버의 턴 순서를 우선하고, 아직 순서에 없는 플레이어는 명단 순서로 뒤에 붙인다. */
export function toTurnStripPlayers(
  players: Player[],
  turnOrder: PlayerId[] | undefined,
  scores: Record<PlayerId, ScoreBoard> | undefined,
) {
  const byId = new Map(players.map((player) => [player.playerId, player]))
  const ordered = (turnOrder ?? [])
    .map((playerId) => byId.get(playerId))
    .filter((player): player is Player => player !== undefined)
  const orderedIds = new Set(ordered.map((player) => player.playerId))
  const rest = players.filter((player) => !orderedIds.has(player.playerId))
  return [...ordered, ...rest].map((player) => ({
    nickname: player.nickname,
    playerId: player.playerId,
    status: player.status,
    total: scores?.[player.playerId]?.total ?? 0,
  }))
}

export function toMatrixPlayers(
  players: Player[],
  scores: Record<PlayerId, ScoreBoard> | undefined,
  you: PlayerId,
) {
  const ordered = [...players].sort((left, right) => {
    if (left.playerId === you) return -1
    if (right.playerId === you) return 1
    return 0
  })
  return ordered.map((player) => ({
    nickname: player.playerId === you ? '나' : player.nickname,
    playerId: player.playerId,
    scoreboard: scores?.[player.playerId],
  }))
}
