import type { CategoryScores } from '@/yacht/domain/scoring'
import type { toMatrixPlayers } from '@/yacht/model/playerViews'

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

export function scoreLeaderLabel(players: ReturnType<typeof toMatrixPlayers>) {
  const leader = players.reduce(
    (best, player) =>
      (player.scoreboard?.total ?? 0) > (best?.scoreboard?.total ?? 0) ? player : best,
    players[0],
  )
  return leader ? `${leader.nickname} · ${leader.scoreboard?.total ?? 0}` : '—'
}

export function scoreSheetHint(isMyTurn: boolean, rolled: boolean, activePlayerName?: string) {
  if (!isMyTurn) return `${activePlayerName ?? '—'} 차례`
  return rolled ? '행을 탭하면 바로 기록됩니다' : '먼저 주사위를 굴리세요'
}

export function scoreRecordTitle(isMyTurn: boolean, activePlayerName?: string) {
  return `기록 — ${isMyTurn ? '나' : (activePlayerName ?? '—')}`
}
