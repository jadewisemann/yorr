import type { GameState, Player, PlayerId } from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import { applyLeverage } from '@/yacht/domain/leverage'
import {
  type CategoryScores,
  calculateScoreCandidates,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/yacht/domain/scoring'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'
import { scoreLeaderLabel } from './gamePlayLabels'
import { toMatrixPlayers, toTurnStripPlayers } from './playerViews'

interface GamePlayViewInput {
  dice: DiceSet | null
  game: GameState | undefined
  leverageCategory: YachtCategory | null
  players: Player[]
  you: PlayerId
}

export function buildGamePlayView({
  dice,
  game,
  leverageCategory,
  players,
  you,
}: GamePlayViewInput) {
  const activePlayerId = game?.activePlayerId
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined
  const recorded = (category: YachtCategory) => isRecorded(activeBoard?.categories[category])
  const usedCategories = YACHT_CATEGORIES.filter(recorded)
  const sheetPlayers = toMatrixPlayers(players, game?.scores, you)

  return {
    activeBoard,
    activePlayer: players.find((player) => player.playerId === activePlayerId),
    activePlayerId,
    candidates: (dice
      ? applyLeverage(calculateScoreCandidates(dice, usedCategories), leverageCategory)
      : {}) as CategoryScores,
    leaderLabel: scoreLeaderLabel(sheetPlayers),
    myBoard: game?.scores[you],
    openCategories: YACHT_CATEGORIES.filter((category) => !recorded(category)),
    rolled: dice !== null,
    sheetPlayers,
    turnPlayers: toTurnStripPlayers(players, game?.turnOrder, game?.scores),
  }
}
