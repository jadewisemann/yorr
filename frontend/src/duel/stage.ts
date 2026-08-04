import { DUEL_MISS, type DuelRound, type DuelState } from '@/realtime/wsEvents'
import type { ArenaPhase, Fighter } from './Arena'
import { missTaunt, type ShotTarget } from './duel'
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
  /** 각 진영이 쏜 총알. null이면 아직(또는 끝까지) 뽑지 않았다. */
  leftShot: ShotTarget | null
  rightShot: ShotTarget | null
  /** 이 진영의 총알이 빗나갔는가 — 쐈지만 상대가 더 빨랐다. */
  leftMiss: boolean
  rightMiss: boolean
  /**
   * 총알이 스쳐 지나간 쪽(= 안 맞은 쪽)과 그가 내뱉는 한마디. 말풍선이 이 진영 머리 위에
   * 뜬다. 아무도 빗나가지 않았으면 null.
   */
  miss: { side: 1 | 2; taunt: string } | null
  /** 1ms까지 같아 총알이 공중에서 부딪히는 라운드. */
  clash: boolean
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
  /** 총알이 목표에 닿았는가. */
  impact: boolean
  /**
   * 내가 이번 라운드에 쏜 총알 — 서버 응답을 기다리지 않는 로컬 신호다. 반응한 순간에 총알이
   * 떠나야 하나의 동작으로 읽힌다. 왕복 지연(유예 최대 700ms)만큼 기다리면 뽑는 동작과
   * 총알이 따로 노는 두 동작이 된다. 상대에게 갈지 발밑에 박힐지는 신호를 봤는지로 갈린다.
   */
  youShot: ShotTarget | null
}

export function buildStage({
  impact,
  opponentId,
  opponentName,
  state,
  you,
  youShot,
}: StageInput): Stage {
  const round = state.lastRound ?? null
  // 내 기록만 나왔고 상대를 기다리는 중. 총알과 달리 이쪽은 서버 응답을 기다린다 —
  // 기록(ms)은 서버가 검증한 값이라, 앞질러 그리면 잠깐 빈 자리를 "얼어붙음"으로 읽는다.
  const pending = state.phase === 'SIGNAL' && state.reactions[you] !== undefined
  const settled = state.phase === 'RESULT'

  /**
   * 이 사람이 쏜 총알. 내 것은 탭한 순간 알지만, 상대 것은 판정이 난 뒤에만 밝힌다 —
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
    hp: (state.hp[playerId] ?? 0) + (settled && !impact && round?.hitId === playerId ? 1 : 0),
    ms: playerId === you || settled ? (state.reactions[playerId] ?? null) : null,
    name,
    outfit,
    pose: poseOf(playerId, round, settled, impact, shot !== null),
  })

  const [leftMiss, rightMiss] = missedSides(
    round,
    settled,
    [you, leftShot],
    [opponentId, rightShot],
  )
  // 빗나간 총알이 스쳐 지나간 쪽이 말한다 — 쏜 쪽이 아니라 맞힌 쪽, 즉 승자다.
  const misser = leftMiss ? you : rightMiss ? opponentId : null
  const winnerSide = settled ? sideOf(round?.shooterId, you, opponentId) : 0

  return {
    // 1ms까지 같은 라운드만 총알이 공중에서 부딪힌다. 그 전에는 각자 제 갈 길로 날아간다.
    clash: settled && round?.kind === 'TIE' && leftShot === 'opponent' && rightShot === 'opponent',
    foulSide: settled ? sideOf(round?.foulId, you, opponentId) : 0,
    ko: settled && !!round?.over,
    left: fighter(you, '나', OUTFIT_LEFT, leftShot),
    leftMiss,
    leftShot,
    // 비아냥은 서버가 준 값(라운드 번호 + 빗나간 쪽 기록)에서 뽑아 두 화면이 같은 말을 한다.
    miss:
      misser && winnerSide !== 0
        ? {
            side: winnerSide,
            taunt: missTaunt((round?.number ?? 0) * 31 + (state.reactions[misser] ?? 0)),
          }
        : null,
    pending,
    phase: arenaPhaseOf(state.phase, pending),
    right: fighter(opponentId, opponentName, OUTFIT_RIGHT, rightShot),
    rightMiss,
    rightShot,
    selfShot: round?.kind === 'SELF_SHOT',
    tie: settled && round?.kind === 'TIE',
    winner: winnerSide,
  }
}

/**
 * 쐈지만 상대가 더 빨랐던 쪽 [왼쪽, 오른쪽] — 총알은 상대까지 가되 빗나간다.
 * 진 쪽 총알을 그냥 지나가게 두면 "맞혔는데 아무 일도 없다"로 읽힌다.
 */
function missedSides(
  round: DuelRound | null,
  settled: boolean,
  left: [id: string, shot: ShotTarget | null],
  right: [id: string, shot: ShotTarget | null],
): [boolean, boolean] {
  // 부정출발 라운드는 서로를 겨누지 않았으므로 빗나감이 없다.
  if (!settled || !round || round.foulId) return [false, false]
  const shooter = round.shooterId
  if (!shooter) return [false, false]
  const missed = ([id, shot]: [string, ShotTarget | null]) => shooter !== id && shot === 'opponent'
  return [missed(left), missed(right)]
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
  drew: boolean,
): Pose {
  // 판정 전 — 뽑았으면 이미 총이 나갔고, 아니면 홀스터에 손을 얹은 채다.
  if (!settled || !round) return drew ? 'draw' : 'ready'
  if (impact && round.koId === playerId) return 'dead'
  if (round.foulId) return foulPose(playerId, round, impact)
  if (round.kind === 'TIE' || round.shooterId === playerId) return 'draw'
  // 진 쪽도 뽑기는 뽑았다(느렸을 뿐) — 총알이 닿기 전까지는 겨눈 자세를 유지한다.
  // 얼어붙어 못 뽑은 쪽만 끝까지 홀스터에 손을 얹고 있다.
  if (impact && round.hitId === playerId) return 'hit'
  return drew ? 'draw' : 'ready'
}

/** 파울 라운드 — 성급하게 뽑은 쪽만 총을 들고 있고(발밑으로 쐈다) 상대는 가만히 있다. */
function foulPose(playerId: string, round: DuelRound, impact: boolean): Pose {
  if (round.foulId !== playerId) return 'ready'
  return impact && round.kind === 'SELF_SHOT' ? 'hit' : 'draw'
}
