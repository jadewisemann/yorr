import type { LocalPingPongState } from '@/pingpong/domain/localGame'
import type { PingPongEvent, PingPongPhase, PingPongState } from '@/realtime/wsEvents'

/**
 * 파티 모드에서 대시보드가 판정한 로컬 상태를 **서버 계약의 `PingPongState`로 옮긴다**
 * (ADR-0003). 이 값이 `game.ping_pong.host_state`로 올라가 방에 뿌려지므로, 폰의 점수판과
 * 서버의 최종 점수가 전부 여기서 나온다.
 *
 * 대시보드 자신의 3D는 이 변환을 거치지 않고 `localFrameState`로 직접 그린다 — 변환은
 * 손실이 있고(스윙 시각·공의 좌우 보간), 판정과 렌더가 같은 기기에 있는 것이 이 설계의
 * 목적이기 때문이다.
 */

const FAULT = { out: 'OUT', net: 'NET' } as const

const PHASE: Record<LocalPingPongState['phase'], PingPongPhase> = {
  playing: 'PLAYING',
  point: 'COUNTDOWN',
  over: 'FINISHED',
}

export interface HostStateInput {
  /** 서버가 만든 초기 상태. `playerOrder`·`lastInputSeq`·`readyPlayerIds`를 여기서 물려받는다. */
  base: PingPongState
  local: LocalPingPongState
  /** 단조 증가. 서버가 되돌아가는 보고를 거절하는 근거다. */
  version: number
  /** 벽시계(`Date.now()`). 로컬 시뮬레이션은 `performance.now()`를 쓰므로 여기서 갈린다. */
  now: number
  /** 남은 카운트다운(ms). 로컬의 `nextServeAt`은 performance 시계라 호출부가 환산해 넘긴다. */
  countdownMs: number
  lastEvent?: PingPongEvent | undefined
}

export function toPingPongState({
  base,
  local,
  version,
  now,
  countdownMs,
  lastEvent,
}: HostStateInput): PingPongState {
  const [first, second] = base.playerOrder
  const phase = PHASE[local.phase]
  return {
    version,
    phase,
    playerOrder: base.playerOrder,
    scores: {
      ...(first ? { [first]: local.s1 } : {}),
      ...(second ? { [second]: local.s2 } : {}),
    },
    lastInputSeq: base.lastInputSeq,
    readyPlayerIds: base.readyPlayerIds,
    ball: {
      // 로컬 `pos`는 **지금 위치**다. 그래서 `launchedAt`이 지금이어야 받는 쪽이
      // `pos + direction × speed × 경과초`로 같은 공을 그린다.
      pos: local.ball.pos,
      direction: local.ball.dir,
      speed: local.ball.speed,
      smash: local.ball.smash,
      // 로컬은 소문자 `'out'|'net'`, 와이어는 대문자다.
      fault: local.ball.fault ? FAULT[local.ball.fault] : null,
      faultFrom: local.ball.faultFrom,
      x0: local.ball.x0,
      x1: local.ball.x1,
      launchedAt: now,
    },
    rally: local.rally,
    serveReceiverId: serveReceiverOf(base, local) ?? null,
    // 카운트다운 중일 때만 마감이 있다. 서버는 이 값으로 예약하지 않지만(파티 방에서는
    // 예약을 걸지 않는다) 폰이 "곧 서브"를 그리는 근거가 된다.
    nextActionAt: phase === 'COUNTDOWN' ? now + Math.max(0, countdownMs) : 0,
    lastEvent: lastEvent ?? null,
  }
}

function serveReceiverOf(base: PingPongState, local: LocalPingPongState): string | undefined {
  return base.playerOrder[local.serveReceiver - 1]
}

/** 로컬 플레이어 번호(1·2) ↔ playerId. 서버가 정한 `playerOrder`가 유일한 근거다. */
export function playerNumberOf(base: PingPongState, playerId: string): 1 | 2 | null {
  const index = base.playerOrder.indexOf(playerId)
  if (index === 0) return 1
  if (index === 1) return 2
  return null
}
