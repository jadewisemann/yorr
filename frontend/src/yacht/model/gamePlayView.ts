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

/**
 * 진행 중인 턴의 화면 상태 묶음. `GamePlay`가 튜토리얼 가이드(`guide` prop)에 넘기고,
 * `TutorialGuide`가 그대로 받는다 — 컴포넌트마다 다시 선언하지 않는다.
 */
export interface TurnProgress {
  rolled: boolean
  keptValues: number[]
  rolling: boolean
  submitted: boolean
  rollCount: number
  candidates: CategoryScores
  motionNoticeVisible: boolean
  wide: boolean
}

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
