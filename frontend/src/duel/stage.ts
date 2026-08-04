import type { DuelRound, DuelState } from '@/realtime/wsEvents'
import type { ArenaPhase, Fighter } from './Arena'
import { OUTFIT_LEFT, OUTFIT_RIGHT, type Outfit, type Pose } from './Gunslinger'

/**
 * 서버 상태 → 무대 화면. 순수 함수라 React·DOM을 모른다.
 *
 * 서버는 진영 번호를 주지 않고 playerId만 준다. 여기서 <b>나를 항상 왼쪽</b>에 두고 좌우를
 * 매기므로, 두 사람이 각자의 화면에서 자기를 왼쪽에 두고 같은 결투를 본다.
 *
 * 또 하나의 일은 "총알이 닿기 전"을 그려 주는 것이다. 서버 상태의 체력은 이미 판정이 끝난
 * 값이지만, 총알이 날아가는 동안 체력이 먼저 깎여 보이면 인과가 뒤집힌다 — impact가 false인
 * 구간에서는 맞은 쪽의 체력을 한 칸 되돌리고 자세도 아직 서 있는 것으로 준다.
 */

/** Arena가 그대로 받는 "지금 이 화면". */
export interface Stage {
  phase: ArenaPhase
  left: Fighter
  right: Fighter
  winner: 0 | 1 | 2
  foulSide: 0 | 1 | 2
  tie: boolean
  selfShot: boolean
  ko: boolean
  pending: boolean
}

interface StageInput {
  state: DuelState
  /** 나의 playerId. */
  you: string
  opponentId: string
  opponentName: string
  /** 총알이 상대에게 닿았는가. */
  impact: boolean
}

export function buildStage({ impact, opponentId, opponentName, state, you }: StageInput): Stage {
  const round = state.lastRound ?? null
  // 내 기록만 나왔고 상대를 기다리는 중.
  const pending = state.phase === 'SIGNAL' && state.reactions[you] !== undefined
  const settled = state.phase === 'RESULT'

  const fighter = (playerId: string, name: string, outfit: Outfit): Fighter => ({
    fouls: state.fouls[playerId] ?? 0,
    hp: (state.hp[playerId] ?? 0) + (settled && !impact && round?.hitId === playerId ? 1 : 0),
    // 상대의 기록은 판정이 난 뒤에만 밝힌다 — 유예 중에 먼저 보이면 승부가 김이 샌다.
    ms: playerId === you || settled ? (state.reactions[playerId] ?? null) : null,
    name,
    outfit,
    pose: poseOf(playerId, round, settled, impact),
  })

  return {
    foulSide: settled ? sideOf(round?.foulId, you, opponentId) : 0,
    ko: settled && !!round?.over,
    left: fighter(you, '나', OUTFIT_LEFT),
    pending,
    phase: arenaPhaseOf(state.phase, pending),
    right: fighter(opponentId, opponentName, OUTFIT_RIGHT),
    selfShot: round?.kind === 'SELF_SHOT',
    tie: settled && round?.kind === 'TIE',
    winner: settled ? sideOf(round?.shooterId, you, opponentId) : 0,
  }
}

function arenaPhaseOf(phase: DuelState['phase'], pending: boolean): ArenaPhase {
  if (phase === 'WAITING') return 'waiting'
  if (phase === 'SIGNAL') return pending ? 'result' : 'signal'
  return 'result'
}

/** 뷰 기준 진영 — 1=왼쪽(나) · 2=오른쪽(상대) · 0=아무도. */
function sideOf(playerId: string | null | undefined, you: string, opponentId: string): 0 | 1 | 2 {
  if (playerId === you) return 1
  if (playerId && playerId === opponentId) return 2
  return 0
}

function poseOf(
  playerId: string,
  round: DuelRound | null,
  settled: boolean,
  impact: boolean,
): Pose {
  if (!settled || !round) return 'ready'
  if (impact && round.koId === playerId) return 'dead'
  // 파울 라운드: 성급하게 뽑은 쪽만 총을 들고 있고(발밑으로 쐈다) 상대는 가만히 있다.
  if (round.foulId) {
    if (round.foulId !== playerId) return 'ready'
    return impact && round.kind === 'SELF_SHOT' ? 'hit' : 'draw'
  }
  if (round.kind === 'TIE' || round.shooterId === playerId) return 'draw'
  if (impact && round.shooterId) return 'hit'
  return 'ready'
}
