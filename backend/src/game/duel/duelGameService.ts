import { randomInt } from 'node:crypto'
import { ConflictError, DomainError } from '../../errors.js'
import type {
  DuelBroadcaster,
  DuelCompletionPort,
  DuelDeadlineScheduler,
  DuelPresence,
  DuelRoomSnapshotPort,
  DuelScoreboardPort,
} from './duelPorts.js'
import { DuelProgress } from './duelProgress.js'
import {
  draw as applyDraw,
  expire,
  finish,
  forfeit,
  initialDuelState,
  MAX_WAIT_MILLIS,
  MIN_WAIT_MILLIS,
  nextRound,
  signal,
} from './duelRules.js'
import type { DuelState } from './duelState.js'
import type { DuelStateStore } from './duelStateStore.js'

/** WS `game.duel.draw` 페이로드(정본: `frontend/src/realtime/wsEvents.ts`). */
export interface DuelDrawPayload {
  readonly inputSeq: number
  /**
   * 클라이언트가 신호를 본 순간부터 잰 값. **음수면 신호 전에 뽑았다는 신고**
   * (부정출발)다. 검증·판정은 전부 `duelRules.ts`가 한다.
   */
  readonly reactionMs: number
}

/** 시작 시점의 참가자 명단. `room/snapshot.ts`의 `RoomSnapshot`이 그대로 만족한다. */
export interface DuelStartRoster {
  readonly hostId: string | null
  readonly players: readonly { readonly playerId: string; readonly kind: string }[]
}

export interface DuelGameServiceDeps<S> {
  readonly states: DuelStateStore
  readonly scheduler: DuelDeadlineScheduler
  readonly broadcaster: DuelBroadcaster
  readonly realtimeSnapshots: DuelRoomSnapshotPort<S>
  readonly presence: DuelPresence
  readonly completion: DuelCompletionPort
  readonly scoreboard: DuelScoreboardPort
}

export interface DuelGameServiceOptions {
  /** 테스트가 시계를 고정한다. 운영 기본값은 `Date.now`. */
  readonly now?: () => number
  /** 빨강→초록 대기(ms). 기본값은 1400~4600 서버 RNG — **매 라운드 재추첨**한다. */
  readonly wait?: () => number
}

/** 게임 상태가 실린 스냅샷 — 방 스냅샷 그대로에 `game` 하나만 얹은 모양이다(2.8과 같음). */
export type DuelSnapshot<S> = S | (S & { readonly game: DuelState })

/**
 * 결투 진행의 권위.
 *
 * 신호등을 언제 초록으로 바꿀지, 라운드를 언제 넘길지 전부 서버가 스케줄러로 잡는다 —
 * 두 클라이언트가 같은 순간에 같은 신호를 보게 하려면 시각의 주인이 하나여야 한다
 * (DESIGN.md 원칙 1 서버 권위: **반응 시간 판정도 서버가 한다**).
 *
 * 상태 전이는 전부 `states.mutate` 안의 순수 규칙 함수다. 이 클래스가 하는 일은
 * ① 시각·난수 주입 ② 방송 ③ 다음 마감 예약 ④ 종료 시 점수·완료 처리뿐이다.
 */
export class DuelGameService<S> {
  private readonly states: DuelStateStore
  private readonly scheduler: DuelDeadlineScheduler
  private readonly realtimeSnapshots: DuelRoomSnapshotPort<S>
  private readonly presence: DuelPresence
  private readonly now: () => number
  private readonly wait: () => number
  private readonly progress: DuelProgress<S>

  constructor(deps: DuelGameServiceDeps<S>, options: DuelGameServiceOptions = {}) {
    this.states = deps.states
    this.scheduler = deps.scheduler
    this.realtimeSnapshots = deps.realtimeSnapshots
    this.presence = deps.presence
    this.now = options.now ?? Date.now
    this.wait = options.wait ?? randomWait
    this.progress = new DuelProgress<S>(
      {
        scheduler: deps.scheduler,
        broadcaster: deps.broadcaster,
        snapshots: deps.realtimeSnapshots,
        scoreboard: deps.scoreboard,
        completion: deps.completion,
      },
      this.now,
      (roomId, expectedVersion) => this.timeout(roomId, expectedVersion),
    )
  }

  /**
   * 상태 초기화 + 첫 신호 예약. **호스트가 playerOrder[0]** 이다 —
   * 화면 좌우 배치가 아니라 판정 순서의 기준이라 안정적이어야 한다.
   *
   * 봇은 명단에서 걸러낸다. 카탈로그가 `supportsBots: false`로 막지만 여기서 한 번 더
   * 확인해 2인이 아니면 `duel_requires_two_players`로 시작을 거부한다(라이프사이클이
   * 그 예외로 START를 롤백한다).
   */
  async start(roomId: string, roster: DuelStartRoster): Promise<void> {
    const humans = roster.players.filter((player) => player.kind === 'HUMAN')
    const players = [
      ...humans.filter((player) => player.playerId === roster.hostId),
      ...humans.filter((player) => player.playerId !== roster.hostId),
    ].map((player) => player.playerId)
    if (players.length !== 2) throw new ConflictError('duel_requires_two_players')

    const state = initialDuelState(players, this.now(), this.wait())
    await this.states.initialize(roomId, state)
    // 이걸 빼면 진행 중 방의 레지스트리 phase가 waiting에 머물러, 끊긴 플레이어가
    // offline이 아니라 room.player_left가 된다(IMPLEMENTATION_NOTES 2.1).
    this.presence.markPhase(roomId, 'playing')
    await this.progress.broadcastState(roomId, state, true)
    this.schedule(roomId, state)
  }

  /** 총을 뽑았다. payload 검증만 여기서 하고 판정은 규칙 함수가 한다. */
  async draw(roomId: string, playerId: string, payload: DuelDrawPayload): Promise<void> {
    if (!Number.isFinite(payload.inputSeq) || payload.inputSeq < 0) {
      throw new DomainError('invalid_duel_draw')
    }
    if (!Number.isFinite(payload.reactionMs)) throw new DomainError('invalid_duel_draw')
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyDraw(current, {
        playerId,
        inputSeq: payload.inputSeq,
        reportedMs: payload.reactionMs,
        now,
      }),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 재접속 스냅샷. 상태가 없으면 방 스냅샷 그대로(대기실·이미 정리된 방). */
  async reconnect(roomId: string): Promise<DuelSnapshot<S>> {
    const state = await this.states.find(roomId)
    if (state === null) return this.realtimeSnapshots.snapshot(roomId)
    return this.progress.snapshot(roomId, state)
  }

  /** 타이머만 되살린다 — 상태는 그대로다. 종료된 결투는 예약하지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null || state.phase === 'FINISHED') return
    this.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(옛 deploy/PLAN.md PR 6).
   *
   * **결투는 예약 로직을 새로 만들 것이 없다.** 마감(`nextActionAt`)이 처음부터
   * 상태 안의 절대 epoch ms이고 그 상태는 Redis에 있으므로, 되살리는 것은 `resume`과
   * 같은 예약이다(이미 지난 마감은 예약기가 지연 0으로 깎아 즉시 발화한다).
   * 야추만 마감이 프로세스 인메모리였고, 그것을 고친 것이 PR 6이다.
   *
   * `resume`과 다른 점은 **이어갈 수 없을 때 던진다**는 것뿐이다 — 부팅 복구에서는
   * 조용히 넘어가면 상태만 살아 있고 턴이 멈춘 방이 남는다.
   */
  async rehydrate(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null) {
      throw new Error(`진행 중이라던 방에 결투 상태가 없습니다: ${roomId}`)
    }
    if (state.phase === 'FINISHED') {
      throw new Error(`결투가 이미 끝난 방입니다(종료 전이 실패): ${roomId}`)
    }
    this.schedule(roomId, state)
  }

  async pause(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
  }

  /**
   * 게임 중 이탈 — **forfeit만 적용한다.** 레지스트리·roster 제거는 호출자(WS
   * 게이트웨이·라이프사이클) 몫이다(야추·탁구와 다르다).
   */
  async removePlayer(roomId: string, playerId: string): Promise<void> {
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) => forfeit(current, playerId, now))
    if (next !== null) await this.changed(roomId, next)
  }

  /** 로비 복귀 — 상태를 버리고 대기실 스냅샷을 다시 뿌린다. */
  async reset(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
    await this.states.remove(roomId)
    this.presence.markPhase(roomId, 'waiting')
    await this.progress.syncRoom(roomId)
  }

  async close(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
    await this.states.remove(roomId)
  }

  async hasState(roomId: string): Promise<boolean> {
    return (await this.states.find(roomId)) !== null
  }

  /**
   * 대기 → 신호 · 신호 → 무효 · 결과 → 다음 라운드(또는 종료)를 잇는 **유일한 시계**다.
   *
   * 기대 버전이 어긋나면 아무것도 하지 않는다 — 그 마감은 이미 지나간 상태의 것이고,
   * 지금 상태에는 자기 마감이 따로 예약돼 있다.
   */
  private async timeout(roomId: string, expectedVersion: number): Promise<void> {
    const now = this.now()
    const wait = this.wait()
    const next = await this.states.mutate(roomId, (current) => {
      if (current.version !== expectedVersion || current.phase === 'FINISHED') return null
      switch (current.phase) {
        case 'WAITING':
          return signal(current, now)
        case 'SIGNAL':
          return expire(current, now)
        case 'RESULT':
          return current.lastRound?.over === true ? finish(current) : nextRound(current, now, wait)
      }
    })
    if (next !== null) await this.changed(roomId, next)
  }

  private async changed(roomId: string, state: DuelState): Promise<void> {
    await this.progress.changed(roomId, state)
  }

  private schedule(roomId: string, state: DuelState): void {
    this.progress.schedule(roomId, state)
  }
}

/** [1400, 4600) — 반열림 구간이다. */
const randomWait = (): number => randomInt(MIN_WAIT_MILLIS, MAX_WAIT_MILLIS)
