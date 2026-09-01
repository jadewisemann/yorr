import { ConflictError, DomainError } from '../../errors.js'
import { PING_PONG } from '../catalog.js'
import { gameWsType } from '../module.js'
import type {
  PingPongBroadcaster,
  PingPongCompletionPort,
  PingPongDeadlineScheduler,
  PingPongOutboundEnvelope,
  PingPongPresence,
  PingPongRoomService,
  PingPongScoreWriter,
  PingPongSnapshotService,
  PingPongStateStore,
} from './pingPongPorts.js'
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
const TARGET_X_MIN = 0.15
const TARGET_X_MAX = 0.85

const defaultRandomTarget = (): number =>
  TARGET_X_MIN + Math.random() * (TARGET_X_MAX - TARGET_X_MIN)

export class PingPongGameService<S extends object> {
  private readonly now: () => number
  private readonly randomTarget: () => number

  /**
   * 방마다 "이 판의 랠리를 대시보드가 판정하는가"(frontend ADR-0003).
   *
   * **판이 시작될 때 한 번 정하고 끝날 때까지 유지한다.** 매번 Redis를 읽지 않는 이유가
   * 성능만은 아니다 — 판정 주체가 판 도중에 바뀌면 같은 랠리를 둘이 판정하는 순간이 생긴다.
   * 방이 끝나거나 대기실로 돌아갈 때 지운다.
   */
  private readonly hostJudged = new Map<string, boolean>()

  constructor(
    private readonly deps: PingPongGameServiceDeps<S>,
    options: PingPongGameServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.randomTarget = options.randomTarget ?? defaultRandomTarget
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
    const hostId = game.snapshot.hostId
    const players = game.snapshot.players
      .filter((player) => player.kind === 'HUMAN')
      .slice()
      // 방장 우선, 그 밖은 들어온 순서(playerId 오름차순) 유지 — Array#sort는 안정 정렬이다.
      .sort((left, right) => Number(left.playerId !== hostId) - Number(right.playerId !== hostId))
      .map((player) => player.playerId)
    if (players.length !== 2) throw new ConflictError('ping_pong_requires_two_players')

    const state = initial(players, this.now())
    await this.isHostJudged(roomId)
    await this.deps.states.initialize(roomId, state)
    this.deps.presence.markPhase(roomId, 'playing')
    await this.broadcast(roomId, state, true)
    // PREPARING은 `nextActionAt=0`이라 예약이 걸리지 않는다 — 준비 게이트가 타이머를 대신한다.
    await this.schedule(roomId, state)
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
    if (await this.isHostJudged(roomId)) {
      // 대시보드가 판정하는 판이다. 서버는 판정하지 않고 **그대로 넘긴다** — 링크가 없는
      // 폰의 스윙이 도착하는 유일한 경로라, 이것이 있어야 링크 없이도 파티 탁구가 성립한다.
      // 방 전체 방송인 이유: 대시보드를 서버가 특정하려면 명단에 없는 멤버를 뒤져야 하는데,
      // 컨트롤러는 이 메시지를 무시하면 그만이라 방송이 더 싸다.
      this.deps.broadcaster.broadcast(
        roomId,
        this.envelope(
          'game.ping_pong.swung',
          { playerId, inputSeq: payload.inputSeq, clientTs: payload.clientTs },
          roomId,
        ),
      )
      return
    }
    const swungAt = judgedAt(this.now(), payload.clientTs)
    const next = await this.deps.states.mutate(roomId, (current) =>
      swingRule(current, playerId, payload.inputSeq, swungAt, this.randomTarget()),
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
    if (!(await this.isHostJudged(roomId))) return
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

  /** 진행 중이면 게임 상태를 `game` 필드에 실은 스냅샷, 아니면 방 스냅샷 그대로. */
  async reconnect(roomId: string): Promise<S> {
    const state = await this.deps.states.find(roomId)
    return state === undefined
      ? this.deps.snapshots.snapshot(roomId)
      : this.gameSnapshot(roomId, state)
  }

  /** 타이머만 되살린다 — 상태는 그대로다. 끝난 판은 다시 걸지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.deps.states.find(roomId)
    if (state === undefined || isPingPongFinished(state)) return
    await this.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(deploy/PLAN.md PR 6).
   *
   * 탁구도 결투와 같다 — 마감(`nextActionAt`)이 상태 안의 절대 epoch ms이고 상태가
   * Redis에 있으므로 되살릴 것은 예약뿐이다. **여기서 마감을 새로 계산하면 안 된다**:
   * 공의 다음 사건 시각이 곧 마감이라 새 값을 주면 랠리가 어긋난다.
   *
   * `resume`과 다른 점은 이어갈 수 없을 때 던진다는 것뿐이다.
   */
  async rehydrate(roomId: string): Promise<void> {
    const state = await this.deps.states.find(roomId)
    if (state === undefined) {
      throw new Error(`진행 중이라던 방에 탁구 상태가 없습니다: ${roomId}`)
    }
    if (isPingPongFinished(state)) {
      throw new Error(`탁구가 이미 끝난 방입니다(종료 전이 실패): ${roomId}`)
    }
    await this.schedule(roomId, state)
  }

  async pause(roomId: string): Promise<void> {
    this.deps.scheduler.cancelRoom(roomId)
  }

  /**
   * 게임 중 이탈. **순서가 계약이다**(테스트가 고정한다):
   *
   * 1. 이탈 전 phase를 먼저 읽는다 — 상태를 지운 뒤에는 PREPARING이었는지 알 수 없다
   * 2. 좌석 제거(WS 명단) → 방 이탈(Redis)
   * 3. 둘 중 하나라도 실제로 빠졌으면 `room.player_left`
   * (**게임 네임스페이스가 붙지 않는 방 이벤트다**)
   * 4. PREPARING이었으면 **매치 자체를 취소**한다 — 시작도 안 한 판을 이겼다고 주지
   * 않는다. 경기 중이었으면 몰수(생존자 11점, OPPONENT_LEFT)
   */
  async removePlayer(roomId: string, playerId: string): Promise<void> {
    const current = await this.deps.states.find(roomId)
    const preparing = current?.phase === 'PREPARING'

    const removed = this.deps.presence.removePlayer(roomId, playerId)
    const removedFromRoom = await this.deps.rooms.leave(roomId, playerId)
    if (removed !== null || removedFromRoom) {
      this.deps.broadcaster.broadcast(
        roomId,
        this.envelope('room.player_left', { playerId }, roomId),
      )
    }

    if (preparing) {
      await this.cancelPreparation(roomId)
      return
    }
    const now = this.now()
    const next = await this.deps.states.mutate(roomId, (state) => forfeit(state, playerId, now))
    if (next !== undefined) await this.changed(roomId, next)
  }

  /** 로비 복귀 정리. 매치 취소와 달리 `cancelActiveGame`은 부르지 않는다(이미 FINISHED다). */
  async reset(roomId: string): Promise<void> {
    this.deps.scheduler.cancelRoom(roomId)
    this.hostJudged.delete(roomId)
    await this.deps.states.remove(roomId)
    this.deps.presence.markPhase(roomId, 'waiting')
    await this.syncRoom(roomId)
  }

  async close(roomId: string): Promise<void> {
    this.deps.scheduler.cancelRoom(roomId)
    this.hostJudged.delete(roomId)
    await this.deps.states.remove(roomId)
  }

  async hasState(roomId: string): Promise<boolean> {
    return (await this.deps.states.find(roomId)) !== undefined
  }

  /**
   * PREPARING 이탈 → 매치 취소. `reset`과 달리 **START가 세운 gameId까지 되돌린다**
   * (`cancelActiveGame`) — 그러지 않으면 대기실로 돌아간 방에 죽은 gameId가 남아
   * 다음 시작이 막힌다.
   */
  private async cancelPreparation(roomId: string): Promise<void> {
    this.deps.scheduler.cancelRoom(roomId)
    this.hostJudged.delete(roomId)
    await this.deps.states.remove(roomId)
    await this.deps.rooms.cancelActiveGame(roomId)
    this.deps.presence.markPhase(roomId, 'waiting')
    await this.syncRoom(roomId)
  }

  /** 마감 발화. 예약을 걸 때의 version과 다르면(그 사이 스윙이 있었으면) 스테일이다. */
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

  /**
   * 상태가 바뀐 뒤의 공통 후처리.
   *
   * 종료면: 예약 취소 → 최종 점수 기록 → `finishIfComplete(force=true)` →
   * 상태+스냅샷 방송. 점수를 종료 판정보다 **먼저** 써야 `game.over`의 순위가
   * 최종 점수를 본다.
   *
   * COUNTDOWN 진입에만 방 스냅샷을 동봉한다 — 클라이언트가 점수판·명단을
   * 다시 맞추는 지점이 득점 직후이기 때문이고, 랠리 중 매 스윙마다 방 스냅샷을
   * 실으면 프레임마다 Redis를 읽게 된다.
   */
  private async changed(roomId: string, state: PingPongState): Promise<void> {
    if (isPingPongFinished(state)) {
      this.deps.scheduler.cancelRoom(roomId)
      await this.deps.scoreWriter.record(roomId, state.scores)
      await this.deps.completion.finishIfComplete(roomId, true)
      await this.broadcast(roomId, state, true)
      return
    }
    await this.broadcast(roomId, state, state.phase === 'COUNTDOWN')
    await this.schedule(roomId, state)
  }

  /**
   * 이 방의 랠리를 대시보드가 판정하는가. 처음 물을 때 한 번 읽고 캐시한다 —
   * 캐시가 있으면 Redis를 다시 보지 않으므로 **판 도중에 판정 주체가 바뀌지 않는다.**
   */
  private async isHostJudged(roomId: string): Promise<boolean> {
    const cached = this.hostJudged.get(roomId)
    if (cached !== undefined) return cached
    const party = await this.deps.rooms.isPartyRoom(roomId)
    this.hostJudged.set(roomId, party)
    return party
  }

  /**
   * 마감 예약. **대시보드가 판정하는 판에는 걸지 않는다** — 걸어 두면 서버가 자기
   * 시뮬레이션으로 공을 넘기고 점수를 내고 `game.over`까지 만들어, 전적에 틀린 결과가
   * 남는다(frontend ADR-0003 「기각한 대안」).
   */
  private async schedule(roomId: string, state: PingPongState): Promise<void> {
    if (await this.isHostJudged(roomId)) return
    if (isPingPongFinished(state) || state.nextActionAt <= 0) return
    this.deps.scheduler.schedule(roomId, state.version, state.nextActionAt, () =>
      this.timeout(roomId, state.version),
    )
  }

  private async broadcast(
    roomId: string,
    state: PingPongState,
    includeRoomSnapshot: boolean,
  ): Promise<void> {
    // payload가 PingPongState **그대로**인 것이 와이어 계약이다(래핑 없음).
    this.deps.broadcaster.broadcast(
      roomId,
      this.envelope(gameWsType(PING_PONG, 'state'), state, roomId),
    )
    if (!includeRoomSnapshot) return
    const snapshot = await this.gameSnapshot(roomId, state)
    this.deps.broadcaster.broadcast(
      roomId,
      this.envelope(gameWsType(PING_PONG, 'state.sync'), { snapshot }, roomId),
    )
  }

  /** 게임 상태 없이 방 스냅샷만 — 취소·로비 복귀 경로가 쓴다. */
  private async syncRoom(roomId: string): Promise<void> {
    const snapshot = await this.deps.snapshots.snapshot(roomId)
    this.deps.broadcaster.broadcast(
      roomId,
      this.envelope(gameWsType(PING_PONG, 'state.sync'), { snapshot }, roomId),
    )
  }

  private async gameSnapshot(roomId: string, state: PingPongState): Promise<S> {
    const room = await this.deps.snapshots.snapshot(roomId)
    return { ...room, game: state }
  }

  private envelope(type: string, payload: unknown, roomId: string): PingPongOutboundEnvelope {
    return { type, ts: this.now(), payload, roomId }
  }
}
