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
  /** 지금 트레이에 깔린 주사위. 아직 안 굴렸으면 null. */
  dice: DiceSet | null
  game: GameState | undefined
  /** 레버리지 모드가 이번 턴에 2배를 건 족보. 일반 모드는 null. */
  leverageCategory: YachtCategory | null
  players: Player[]
  you: PlayerId
}

/**
 * 화면이 그릴 값을 한 번에 계산한다 — 미리보기 점수, 열린·기록된 족보, 두 가지 플레이어 정렬.
 *
 * 화면에서 뽑아낸 이유는 길이가 아니라 <b>읽는 순서</b>다. 이 여덟 값이 JSX 조각들 사이사이에
 * 흩어져 있어서, 「점수표에 뭘 넘기지?」를 알려면 파일을 위아래로 세 번 오가야 했다.
 * React를 모르는 순수 함수라 단위 테스트로 규칙만 따로 검사할 수 있다.
 */
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
  // 디자인의 한 장 점수시트 — 모든 플레이어를 열로 눕힌다. 내 열이 항상 첫 번째다.
  const sheetPlayers = toMatrixPlayers(players, game?.scores, you)

  return {
    activeBoard,
    activePlayer: players.find((player) => player.playerId === activePlayerId),
    activePlayerId,
    /** 레버리지 족보는 미리보기부터 2배로 보여야 한다 — 기록하고 나서야 알면 고를 수 없다. */
    candidates: (dice
      ? applyLeverage(calculateScoreCandidates(dice, usedCategories), leverageCategory)
      : {}) as CategoryScores,
    leaderLabel: scoreLeaderLabel(sheetPlayers),
    myBoard: game?.scores[you],
    /** 디자인의 quick chips — 열린 족보를 고정 순서로 눕힌다. */
    openCategories: YACHT_CATEGORIES.filter((category) => !recorded(category)),
    rolled: dice !== null,
    sheetPlayers,
    /** 상단 진행 표시 — 서버가 준 턴 순서 그대로다(명단 순서는 턴 순서가 아니다). */
    turnPlayers: toTurnStripPlayers(players, game?.turnOrder, game?.scores),
  }
}
