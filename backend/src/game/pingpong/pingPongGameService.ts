import { ConflictError, DomainError } from '../../errors.js'
import type {
  PingPongBroadcaster,
  PingPongCompletionPort,
  PingPongDeadlineScheduler,
  PingPongPresence,
  PingPongRoomService,
  PingPongScoreWriter,
  PingPongSnapshotService,
  PingPongStateStore,
} from './pingPongPorts.js'
import { PingPongProgress } from './pingPongProgress.js'
import { PingPongResume } from './pingPongResume.js'
import {
  expire,
  forfeit,
  hostReport,
  initial,
  judgedAt,
  ready as readyRule,
  serve,
  swing as swingRule,
} from './pingPongRules.js'
import {
  isPingPongFinished,
  type PingPongState,
  type PingPongSwingPayload,
} from './pingPongState.js'

/**
 * 탁구 한 판의 진행.
 *
 * 규칙은 `pingPongRules.ts`(순수)가, 원자성·TTL은 스토어가, 바깥 계층은 전부
 * `pingPongPorts.ts`의 좁은 포트가 맡는다. 이 클래스가 갖는 것은 **순서**다:
 * 언제 방송하고, 언제 스냅샷을 동봉하고, 무엇을 먼저 취소하는지.
 *
 * 스케줄링은 duel과 같은 version 키 방식이다 — 모든 변이가 version을 +1 하므로
 * 예약을 걸 때의 version과 발화 시점의 version이 다르면 그 예약은 스테일이다.
 */

/** START Lua 결과에서 실제로 읽는 것만 — `room/roomService.ts`의 `GameStartResult`가 만족한다. */
export interface PingPongGameStart {
  readonly snapshot: {
    readonly hostId: string | null
    readonly players: readonly { readonly playerId: string; readonly kind: string }[]
  }
}

export interface PingPongGameServiceDeps<S extends object> {
  readonly states: PingPongStateStore
  readonly scheduler: PingPongDeadlineScheduler
  readonly broadcaster: PingPongBroadcaster
  readonly snapshots: PingPongSnapshotService<S>
  readonly presence: PingPongPresence
  readonly completion: PingPongCompletionPort
  readonly scoreWriter: PingPongScoreWriter
  readonly rooms: PingPongRoomService
}

export interface PingPongGameServiceOptions {
  /** 주입 가능한 시계. 판정 시각이 계약이라 테스트는 실시간 sleep을 쓰지 않는다. */
  readonly now?: () => number
  /**
   * 좌우 목표점.
   * **공이 어디로 갈지는 서버만 정한다**(DESIGN.md 원칙 1).
   */
  readonly randomTarget?: () => number
}

/** 좌우 목표점의 유효 범위 — 테이블 끝에 붙지 않도록 양쪽을 잘라 둔다. */
export const TARGET_X_MIN = 0.15
export const TARGET_X_MAX = 0.85

const defaultRandomTarget = (): number =>
  TARGET_X_MIN + Math.random() * (TARGET_X_MAX - TARGET_X_MIN)

/**
 * 사람만 남기고 **방장을 맨 앞**에 둔다 — 첫 서브의 리시버가 방장이다.
 * 그 밖은 들어온 순서(playerId 오름차순)를 유지한다(`Array#sort`는 안정 정렬이다).
 */
const orderedPlayerIds = (snapshot: PingPongGameStart['snapshot']): string[] => {
  const hostId = snapshot.hostId
  const players = snapshot.players
    .filter((player) => player.kind === 'HUMAN')
    .slice()
    .sort((left, right) => Number(left.playerId !== hostId) - Number(right.playerId !== hostId))
    .map((player) => player.playerId)
  if (players.length !== 2) throw new ConflictError('ping_pong_requires_two_players')
  return players
}

export class PingPongGameService<S extends object> {
  private readonly now: () => number
  private readonly randomTarget: () => number

  private readonly progress: PingPongProgress<S>
  private readonly resumeService: PingPongResume<S>

  constructor(
    private readonly deps: PingPongGameServiceDeps<S>,
    options: PingPongGameServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.randomTarget = options.randomTarget ?? defaultRandomTarget
    this.progress = new PingPongProgress<S>(
      {
        scheduler: deps.scheduler,
        broadcaster: deps.broadcaster,
        snapshots: deps.snapshots,
        presence: deps.presence,
        completion: deps.completion,
        rooms: deps.rooms,
        scoreWriter: deps.scoreWriter,
        states: deps.states,
      },
      this.now,
      (roomId, expectedVersion) => this.timeout(roomId, expectedVersion),
    )
    this.resumeService = new PingPongResume<S>({ states: deps.states, progress: this.progress })
  }

  /**
   * 방 phase 전이 **후** 상태 초기화. 봇은 걸러내고(탁구는 봇을 지원하지 않는다)
   * **방장을 `playerOrder[0]`** 에 둔다 — 첫 서브의 리시버가 그 사람이다.
   *
   * `markPhase('playing')`이 여기 있는 것이 3.1·3.3과 같은 계약이다: REST로 시작한
   * 게임의 레지스트리 phase를 옮기는 유일한 자리라, 빠지면 진행 중 방의 소켓이
   * 끊길 때 offline이 아니라 player_left가 된다.
   */
  async start(roomId: string, game: PingPongGameStart): Promise<void> {
    const state = initial(orderedPlayerIds(game.snapshot), this.now())
    await this.progress.isHostJudged(roomId)
    await this.deps.states.initialize(roomId, state)
    this.deps.presence.markPhase(roomId, 'playing')
    await this.progress.broadcast(roomId, state, true)
    // PREPARING은 `nextActionAt=0`이라 예약이 걸리지 않는다 — 준비 게이트가 타이머를 대신한다.
    await this.progress.schedule(roomId, state)
  }

  /**
   * 스윙. **업링크 지연만큼 되감아 "친 순간"으로 판정한다** — 되감기 폭은
   * `judgedAt`이 묶는다.
   */
  async swing(
    roomId: string,
    playerId: string,
    payload: PingPongSwingPayload | null | undefined,
  ): Promise<void> {
    if (!payload || payload.inputSeq < 0) throw new DomainError('invalid_ping_pong_swing')
    if (await this.progress.isHostJudged(roomId)) {
      this.progress.relaySwing(roomId, playerId, payload)
      return
    }
    const swungAt = judgedAt(this.now(), payload.clientTs)
    const next = await this.deps.states.mutate(roomId, (current) =>
      swingRule(current, {
        playerId,
        inputSeq: payload.inputSeq,
        now: swungAt,
        targetX: this.randomTarget(),
      }),
    )
    if (next !== undefined) await this.changed(roomId, next)
  }

  /**
   * 대시보드가 판정한 상태 보고 — 파티 모드 호스트 판정(frontend ADR-0003).
   *
   * 서버는 랠리를 다시 계산하지 않지만 **아무거나 받지도 않는다**: `hostReport`가
   * 발신자·version·roster·종료 여부를 본다. 통과하면 그 뒤는 서버가 판정했을 때와 **같은
   * 경로**를 탄다(`changed`) — 방송·최종 점수 기록·완료 판정이 한 곳에 남는다.
   *
   * 대시보드가 판정하는 판이 아니면 조용히 버린다. 오류로 만들면 방 종류를 잘못 안
   * 클라이언트가 게임 중 오류 토스트를 계속 띄운다.
   */
  async hostState(roomId: string, playerId: string, reported: PingPongState): Promise<void> {
    if (!(await this.progress.isHostJudged(roomId))) return
    const next = await this.deps.states.mutate(roomId, (current) =>
      hostReport(current, reported, playerId),
    )
    if (next !== undefined) await this.changed(roomId, next)
  }

  /** 준비 완료. 연습 스윙 전이면 규칙이 같은 상태를 돌려주므로 아무 일도 없다. */
  async ready(roomId: string, playerId: string): Promise<void> {
    const now = this.now()
    const next = await this.deps.states.mutate(roomId, (current) =>
      readyRule(current, playerId, now),
    )
    if (next !== undefined) await this.changed(roomId, next)
  }

  /** 재접속·재개·부팅 복구 — `pingPongResume.ts`가 맡는다. */
  async reconnect(roomId: string): Promise<S> {
    return this.resumeService.reconnect(roomId)
  }

  async resume(roomId: string): Promise<void> {
    return this.resumeService.resume(roomId)
  }

  async rehydrate(roomId: string): Promise<void> {
    return this.resumeService.rehydrate(roomId)
  }

  async pause(roomId: string): Promise<void> {
    this.deps.scheduler.cancelRoom(roomId)
  }

  /** 게임 중 이탈 — 방 정리 순서는 `PingPongProgress.leave`가 정본이다. */
  async removePlayer(roomId: string, playerId: string): Promise<void> {
    await this.progress.leave(roomId, playerId, forfeit)
  }

  /** 로비 복귀 정리. 매치 취소와 달리 `cancelActiveGame`은 부르지 않는다(이미 FINISHED다). */
  async reset(roomId: string): Promise<void> {
    await this.progress.reset(roomId)
  }

  async close(roomId: string): Promise<void> {
    await this.progress.close(roomId)
  }

  async hasState(roomId: string): Promise<boolean> {
    return (await this.deps.states.find(roomId)) !== undefined
  }

  private async timeout(roomId: string, expectedVersion: number): Promise<void> {
    const now = this.now()
    const next = await this.deps.states.mutate(roomId, (current) => {
      if (current.version !== expectedVersion || isPingPongFinished(current)) return null
      return current.phase === 'COUNTDOWN'
        ? serve(current, now, this.randomTarget())
        : expire(current, now)
    })
    if (next !== undefined) await this.changed(roomId, next)
  }

  private async changed(roomId: string, state: PingPongState): Promise<void> {
    await this.progress.changed(roomId, state)
  }
}
