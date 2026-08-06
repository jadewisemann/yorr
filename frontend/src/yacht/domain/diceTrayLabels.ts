import { MAX_ROLLS } from '@/yacht/domain/yachtGame'
import type { GamePlayRoll } from '@/yacht/model/useGamePlayRoll'

export interface KeepRailState {
  /** 레일에 올라간 주사위 수. 라벨의 n/5가 이 값이다. */
  count: number
  /** 그 주사위들의 눈 합. */
  sum: number
  /** 다섯 개가 다 올라가 있는지. 굴림이 남았다면 해제해야 굴릴 수 있다는 뜻이다. */
  full: boolean
}

export function diceTrayLabel({
  activePlayerName,
  currentRollNumber,
  isMyTurn,
}: {
  activePlayerName: string | undefined
  currentRollNumber: number
  isMyTurn: boolean
}) {
  if (!activePlayerName) return '턴 동기화 중'
  return isMyTurn
    ? `롤링 존 · 나 · 굴림 ${currentRollNumber}/${MAX_ROLLS}`
    : `롤링 존 · ${activePlayerName}의 턴`
}

export function diceTrayStatus({
  activePlayerName,
  allKept,
  isMyTurn,
  rolled,
  roundNumber,
  submitted,
}: {
  activePlayerName: string | undefined
  allKept: boolean
  isMyTurn: boolean
  rolled: boolean
  roundNumber: number
  submitted: boolean
}) {
  if (submitted) return '점수가 반영됐습니다 · 다음 턴 대기'
  if (!isMyTurn) return `${activePlayerName ?? '—'}님이 굴리는 중입니다`
  if (allKept) return '모두 킵했습니다 · 해제하거나 족보를 기록하세요'
  if (rolled) return '홀드하고 다시 굴리거나, 족보를 탭해 기록하세요'
  return `라운드 ${roundNumber} — 굴려서 시작하세요`
}

/**
 * 킵 레일에 지금 무엇이 올라가 있는가. 마지막 굴림 뒤에는 더 굴릴 것이 없으므로 킵하지 않은
 * 주사위까지 전부 확정이고, 화면에서도 다섯 개가 레일에 올라앉는다(PhysicsDiceScene keepAll) —
 * 라벨과 합이 그 그림과 같은 것을 세야 한다.
 */
export function keepRailState(
  local: GamePlayRoll['local'],
  keptCount: number,
  lastRollInPlay: boolean,
): KeepRailState {
  if (!local.dice) return { count: keptCount, sum: 0, full: false }
  const onRail = (index: number) => lastRollInPlay || local.held[index] === true
  const count = lastRollInPlay ? 5 : keptCount
  return {
    count,
    sum: local.dice.reduce((sum, value, index) => sum + (onRail(index) ? value : 0), 0),
    full: count === 5,
  }
}

/**
 * "해제해야 굴릴 수 있어요"는 굴림이 남았을 때만 맞는 말이다 — 마지막 굴림 뒤엔 다섯 개가
 * 다 올라가 있어도 해제할 이유가 없다.
 */
export function keptRailLabel(rail: KeepRailState, rollsLeft: number) {
  if (rail.count === 0) return '비어 있음'
  const releaseHint = rail.full && rollsLeft > 0 ? ' · 해제해야 굴릴 수 있어요' : ''
  return `${rail.count}/5 · 합 ${rail.sum}${releaseHint}`
}
