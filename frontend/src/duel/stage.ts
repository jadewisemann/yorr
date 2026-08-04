import { DUEL_MISS, type DuelRound, type DuelState } from '@/realtime/wsEvents'
import type { ArenaPhase, Fighter } from './Arena'
import type { ShotTarget } from './duel'
import { OUTFIT_LEFT, OUTFIT_RIGHT, type Outfit, type Pose } from './Gunslinger'

/**
 * 서버 상태 → 무대 화면. 순수 함수라 React·DOM을 모른다.
 *
 * 서버는 진영 번호를 주지 않고 playerId만 준다. 여기서 <b>나를 항상 왼쪽</b>에 두고 좌우를
 * 매기므로, 두 사람이 각자의 화면에서 자기를 왼쪽에 두고 같은 결투를 본다.
 *
 * 총알이 날아가는 모습은 그리지 않는다. 총알의 방향은 판정이 나야 정해지는데, 판정은 상대가
 * 뽑을 때까지(유예 최대 700ms) 기다려야 나온다 — 그 사이를 비행으로 메우면 쏘는 동작과
 * 맞는 동작이 따로 노는 두 박자가 된다. 그래서 <b>판정이 오는 즉시</b> 맞은 자세로 넘긴다.
 */

/** Arena가 그대로 받는 "지금 이 화면". */
export interface Stage {
  phase: ArenaPhase
  left: Fighter
  right: Fighter
  /** 각 진영이 쏜 총 — 화염이 여기서 터진다. null이면 아직(또는 끝까지) 뽑지 않았다. */
  leftShot: ShotTarget | null
  rightShot: ShotTarget | null
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
  /**
   * 내가 이번 라운드에 쏜 총 — 서버 응답을 기다리지 않는 로컬 신호다. 누른 순간 총이 나가야
   * 입력이 먹히지 않은 것처럼 보이지 않는다. 상대를 겨눴는지 발밑에 쐈는지는 신호를 봤는지로
   * 갈리고, 그건 클라이언트가 그 순간 이미 안다.
   */
  youShot: ShotTarget | null
}

export function buildStage({ opponentId, opponentName, state, you, youShot }: StageInput): Stage {
  const round = state.lastRound ?? null
  // 내 기록만 나왔고 상대를 기다리는 중. 총과 달리 이쪽은 서버 응답을 기다린다 —
  // 기록(ms)은 서버가 검증한 값이라, 앞질러 그리면 잠깐 빈 자리를 "얼어붙음"으로 읽는다.
  const pending = state.phase === 'SIGNAL' && state.reactions[you] !== undefined
  const settled = state.phase === 'RESULT'

  /**
   * 이 사람이 쏜 총. 내 것은 누른 순간 알지만, 상대 것은 판정이 난 뒤에만 밝힌다 —
   * 유예 중에 상대가 뽑는 게 보이면 승부가 김이 샌다.
   */
  const shotOf = (playerId: string): ShotTarget | null => {
    if (playerId === you && youShot) return youShot
    if (!settled) return null
    const reaction = state.reactions[playerId]
    if (reaction === undefined || reaction === DUEL_MISS) return null
    return round?.foulId === playerId ? 'ground' : 'opponent'
  }

  const leftShot = shotOf(you)
  const rightShot = shotOf(opponentId)

  const fighter = (playerId: string, name: string, outfit: Outfit, shot: ShotTarget | null) => ({
    fouls: state.fouls[playerId] ?? 0,
    hp: state.hp[playerId] ?? 0,
    ms: playerId === you || settled ? (state.reactions[playerId] ?? null) : null,
    name,
    outfit,
    pose: poseOf(playerId, round, settled, shot !== null),
  })

  return {
    foulSide: settled ? sideOf(round?.foulId, you, opponentId) : 0,
    ko: settled && !!round?.over,
    left: fighter(you, '나', OUTFIT_LEFT, leftShot),
    leftShot,
    pending,
    phase: arenaPhaseOf(state.phase, pending),
    right: fighter(opponentId, opponentName, OUTFIT_RIGHT, rightShot),
    rightShot,
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

function poseOf(playerId: string, round: DuelRound | null, settled: boolean, drew: boolean): Pose {
  // 판정 전 — 뽑았으면 이미 총이 나갔고, 아니면 홀스터에 손을 얹은 채다.
  if (!settled || !round) return drew ? 'draw' : 'ready'
  if (round.koId === playerId) return 'dead'
  if (round.foulId) return foulPose(playerId, round)
  if (round.kind === 'TIE' || round.shooterId === playerId) return 'draw'
  // 진 쪽도 뽑기는 뽑았다(느렸을 뿐) — 맞은 자세로 넘어간다.
  // 얼어붙어 못 뽑은 쪽은 홀스터에 손을 얹은 채로 맞는다.
  if (round.hitId === playerId) return 'hit'
  return drew ? 'draw' : 'ready'
}

/** 파울 라운드 — 성급하게 뽑은 쪽만 총을 들고 있고(발밑으로 쐈다) 상대는 가만히 있다. */
function foulPose(playerId: string, round: DuelRound): Pose {
  if (round.foulId !== playerId) return 'ready'
  return round.kind === 'SELF_SHOT' ? 'hit' : 'draw'
}
