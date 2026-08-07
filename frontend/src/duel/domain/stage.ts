import { DUEL_MISS, type DuelRound, type DuelState } from '@/realtime/wsEvents'
import { missTaunt, type ShotTarget } from './duel'
import {
  type ArenaPhase,
  type Fighter,
  OUTFIT_LEFT,
  OUTFIT_RIGHT,
  type Outfit,
  type Pose,
} from './fighter'

export interface Stage {
  phase: ArenaPhase
  left: Fighter
  right: Fighter
  leftShot: ShotTarget | null
  rightShot: ShotTarget | null
  leftMiss: boolean
  rightMiss: boolean
  miss: { side: 1 | 2; taunt: string } | null
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
  you: string
  youName: string
  opponentId: string
  opponentName: string
  impact: boolean
  youShot: ShotTarget | null
}

export function buildStage({
  impact,
  opponentId,
  opponentName,
  state,
  you,
  youName,
  youShot,
}: StageInput): Stage {
  const round = state.lastRound ?? null
  const pending = state.phase === 'SIGNAL' && state.reactions[you] !== undefined
  const settled = state.phase === 'RESULT'

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
  const misser = leftMiss ? you : rightMiss ? opponentId : null
  const winnerSide = settled ? sideOf(round?.shooterId, you, opponentId) : 0

  return {
    clash: settled && round?.kind === 'TIE' && leftShot === 'opponent' && rightShot === 'opponent',
    foulSide: settled ? sideOf(round?.foulId, you, opponentId) : 0,
    ko: settled && !!round?.over,
    left: fighter(you, youName, OUTFIT_LEFT, leftShot),
    leftMiss,
    leftShot,
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

function missedSides(
  round: DuelRound | null,
  settled: boolean,
  left: [id: string, shot: ShotTarget | null],
  right: [id: string, shot: ShotTarget | null],
): [boolean, boolean] {
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
  if (!settled || !round) return drew ? 'draw' : 'ready'
  if (impact && round.koId === playerId) return 'dead'
  if (round.foulId) return foulPose(playerId, round, impact)
  if (round.kind === 'TIE' || round.shooterId === playerId) return 'draw'
  if (impact && round.hitId === playerId) return 'hit'
  return drew ? 'draw' : 'ready'
}

function foulPose(playerId: string, round: DuelRound, impact: boolean): Pose {
  if (round.foulId !== playerId) return 'ready'
  return impact && round.kind === 'SELF_SHOT' ? 'hit' : 'draw'
}
