import { randomInt } from 'node:crypto'
import { ConflictError, DomainError } from '../../errors.js'
import { gameWsType } from '../module.js'
import { DAVINCI_CODE } from './davinciCode.js'
import type {
  DavinciAudience,
  DavinciCompletionPort,
  DavinciDeadlineScheduler,
  DavinciPresence,
  DavinciRoomSnapshotPort,
  DavinciScoreboardPort,
} from './davinciPorts.js'
import {
  decide as applyDecide,
  guess as applyGuess,
  place as applyPlace,
  DAVINCI_DECK_SIZE,
  DAVINCI_MAX_PLAYERS,
  DAVINCI_MIN_PLAYERS,
  type DavinciDecision,
  expire,
  forfeit,
  initialDavinciState,
  isGuessableNumber,
  scoreOf,
} from './davinciRules.js'
import { type DavinciState, type DavinciView, toView } from './davinciState.js'
import type { DavinciStateStore } from './davinciStateStore.js'

/** WS `game.davinci_code.guess` 페이로드(정본: `frontend/src/realtime/wsEvents.ts`). */
export interface DavinciGuessPayload {
  readonly inputSeq: number
  readonly targetId: string
  readonly tileId: string
  /** 0~11, 조커는 -1. */
  readonly number: number
}

/** WS `game.davinci_code.decide` 페이로드. */
export interface DavinciDecidePayload {
  readonly inputSeq: number
  readonly decision: DavinciDecision
}

/** WS `game.davinci_code.place` 페이로드. `index`는 손패 왼쪽부터의 삽입 자리다. */
export interface DavinciPlacePayload {
  readonly inputSeq: number
  readonly index: number
}

/** 시작 시점의 참가자 명단. `room/snapshot.ts`의 `RoomSnapshot`이 그대로 만족한다. */
export interface DavinciStartRoster {
  readonly hostId: string | null
  readonly players: readonly { readonly playerId: string; readonly kind: string }[]
}

export interface DavinciGameServiceDeps<S, K> {
  readonly states: DavinciStateStore
  readonly scheduler: DavinciDeadlineScheduler
  readonly audience: DavinciAudience<K>
  readonly realtimeSnapshots: DavinciRoomSnapshotPort<S>
  readonly presence: DavinciPresence
  readonly completion: DavinciCompletionPort
  readonly scoreboard: DavinciScoreboardPort
}

export interface DavinciGameServiceOptions {
  /** 테스트가 시계를 고정한다. 운영 기본값은 `Date.now`. */
  readonly now?: () => number
  /** 섞은 덱 순서(0~25의 순열). 테스트가 판을 고정한다. */
  readonly shuffle?: () => readonly number[]
}

/** 게임 상태가 실린 스냅샷 — 방 스냅샷에 `game` 하나만 얹은 모양이다. */
export type DavinciSnapshot<S> = S | (S & { readonly game: DavinciView })

/**
 * 다빈치 코드 진행의 권위.
 *
 * 상태 전이는 전부 `states.mutate` 안의 순수 규칙 함수다. 이 클래스가 하는 일은
 * ① 시각·난수 주입 ② **사람마다 다른 시점으로 깎아** 보내기 ③ 다음 마감 예약
 * ④ 종료 시 점수·완료 처리뿐이다.
 *
 * 결투·탁구와 갈리는 지점은 ②뿐이다. 그 둘의 상태는 전부 공개 정보라 방 전체에
 * 한 프레임을 뿌리지만, 여기서는 감춘 숫자가 게임 그 자체라 좌석마다 `toView`로
 * 깎아 따로 보낸다(`davinciPorts.ts`의 `DavinciAudience`).
 */
export class DavinciGameService<S, K = unknown> {
  private readonly states: DavinciStateStore
  private readonly scheduler: DavinciDeadlineScheduler
  private readonly audience: DavinciAudience<K>
  private readonly realtimeSnapshots: DavinciRoomSnapshotPort<S>
  private readonly presence: DavinciPresence
  private readonly completion: DavinciCompletionPort
  private readonly scoreboard: DavinciScoreboardPort
  private readonly now: () => number
  private readonly shuffle: () => readonly number[]

  constructor(deps: DavinciGameServiceDeps<S, K>, options: DavinciGameServiceOptions = {}) {
    this.states = deps.states
    this.scheduler = deps.scheduler
    this.audience = deps.audience
    this.realtimeSnapshots = deps.realtimeSnapshots
    this.presence = deps.presence
    this.completion = deps.completion
    this.scoreboard = deps.scoreboard
    this.now = options.now ?? Date.now
    this.shuffle = options.shuffle ?? shuffledDeckOrder
  }

  /**
   * 상태 초기화 + 첫 턴 마감 예약. **호스트가 playerOrder[0]** 이고 첫 턴을 가진다.
   *
   * 봇은 명단에서 걸러낸다. 카탈로그가 `supportsBots: false`로 막지만 여기서 한 번 더
   * 확인해 2~4인이 아니면 시작을 거부한다(라이프사이클이 그 예외로 START를 롤백한다).
   */
  async start(roomId: string, roster: DavinciStartRoster): Promise<void> {
    const humans = roster.players.filter((player) => player.kind === 'HUMAN')
    const players = [
      ...humans.filter((player) => player.playerId === roster.hostId),
      ...humans.filter((player) => player.playerId !== roster.hostId),
    ].map((player) => player.playerId)
    if (players.length < DAVINCI_MIN_PLAYERS || players.length > DAVINCI_MAX_PLAYERS) {
      throw new ConflictError('davinci_requires_two_to_four_players')
    }

    const state = initialDavinciState(players, this.shuffle(), this.now())
    await this.states.initialize(roomId, state)
    this.presence.markPhase(roomId, 'playing')
    await this.broadcast(roomId, state, true)
    this.schedule(roomId, state)
  }

  /** 상대 타일 하나의 숫자를 부른다. payload 검증만 여기서 하고 판정은 규칙이 한다. */
  async guess(roomId: string, playerId: string, payload: DavinciGuessPayload): Promise<void> {
    this.requireInputSeq(payload.inputSeq)
    if (payload.targetId.trim().length === 0 || payload.tileId.trim().length === 0) {
      throw new DomainError('invalid_davinci_guess')
    }
    if (!isGuessableNumber(payload.number)) throw new DomainError('invalid_davinci_guess')
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyGuess(
        current,
        playerId,
        payload.inputSeq,
        payload.targetId,
        payload.tileId,
        payload.number,
        now,
      ),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 맞힌 뒤의 선택 — 이어서 부를지, 멈추고 턴을 넘길지. */
  async decide(roomId: string, playerId: string, payload: DavinciDecidePayload): Promise<void> {
    this.requireInputSeq(payload.inputSeq)
    if (payload.decision !== 'CONTINUE' && payload.decision !== 'STOP') {
      throw new DomainError('invalid_davinci_decision')
    }
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyDecide(current, playerId, payload.inputSeq, payload.decision, now),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 조커를 놓을 자리를 정한다. */
  async place(roomId: string, playerId: string, payload: DavinciPlacePayload): Promise<void> {
    this.requireInputSeq(payload.inputSeq)
    if (!Number.isInteger(payload.index) || payload.index < 0) {
      throw new DomainError('invalid_davinci_place')
    }
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyPlace(current, playerId, payload.inputSeq, payload.index, now),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 재접속 스냅샷. 상태가 없으면 방 스냅샷 그대로(대기실·이미 정리된 방). */
  async reconnect(roomId: string, playerId: string): Promise<DavinciSnapshot<S>> {
    const state = await this.states.find(roomId)
    if (state === null) return this.realtimeSnapshots.snapshot(roomId)
    return this.snapshot(roomId, state, playerId)
  }

  /** 타이머만 되살린다 — 상태는 그대로다. 끝난 판은 예약하지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null || state.phase === 'FINISHED') return
    this.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(deploy/PLAN.md PR 6). 마감(`nextActionAt`)이 상태 안의
   * 절대 epoch ms이고 그 상태는 Redis에 있으므로 되살리는 것은 `resume`과 같은 예약이다
   * (이미 지난 마감은 예약기가 지연 0으로 깎아 즉시 발화한다).
   *
   * 이어갈 수 없으면 **던진다** — 부팅 복구에서 조용히 넘어가면 상태만 살아 있고 턴이
   * 멈춘 방이 남는다.
   */
  async rehydrate(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null) {
      throw new Error(`진행 중이라던 방에 다빈치 코드 상태가 없습니다: ${roomId}`)
    }
    if (state.phase === 'FINISHED') {
      throw new Error(`다빈치 코드가 이미 끝난 방입니다(종료 전이 실패): ${roomId}`)
    }
    this.schedule(roomId, state)
  }

  async pause(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
  }

  /**
   * 게임 중 이탈 — 손패를 공개하고 탈락시킨다. 레지스트리·roster 제거는 호출자(WS
   * 게이트웨이·라이프사이클) 몫이다(결투와 같다).
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
    const snapshot = await this.realtimeSnapshots.snapshot(roomId)
    this.sendToAll(roomId, () => ({
      type: gameWsType(DAVINCI_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot },
      roomId,
    }))
  }

  async close(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
    await this.states.remove(roomId)
  }

  async hasState(roomId: string): Promise<boolean> {
    return (await this.states.find(roomId)) !== null
  }

  private requireInputSeq(inputSeq: number): void {
    if (!Number.isInteger(inputSeq) || inputSeq < 0) throw new DomainError('invalid_davinci_input')
  }

  /**
   * 제한 시간이 지났다. 기대 버전이 어긋나면 아무것도 하지 않는다 — 그 마감은 이미
   * 지나간 상태의 것이고, 지금 상태에는 자기 마감이 따로 예약돼 있다.
   */
  private async timeout(roomId: string, expectedVersion: number): Promise<void> {
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) => {
      if (current.version !== expectedVersion || current.phase === 'FINISHED') return null
      return expire(current, now)
    })
    if (next !== null) await this.changed(roomId, next)
  }

  private async changed(roomId: string, state: DavinciState): Promise<void> {
    if (state.phase !== 'FINISHED') {
      // 턴이 넘어간 프레임에서만 방 스냅샷을 함께 보낸다 — 매 입력마다 덧붙이면
      // 진행 중 화면이 계속 재조립된다(결투 `changed`와 같은 기준).
      await this.broadcast(roomId, state, state.lastEvent?.kind === 'FORFEIT')
      this.schedule(roomId, state)
      return
    }

    this.scheduler.cancelRoom(roomId)
    const scores = new Map<string, number>()
    for (const playerId of state.playerOrder) {
      scores.set(playerId, scoreOf(state, playerId))
    }
    await this.scoreboard.writeScores(roomId, scores)
    // 다빈치 코드에 "점수판 완료"는 없다 — 종료 판정은 항상 강제다.
    await this.completion.finishIfComplete(roomId, true)
    await this.broadcast(roomId, state, true)
  }

  private schedule(roomId: string, state: DavinciState): void {
    if (state.phase === 'FINISHED' || state.nextActionAt <= 0) return
    const version = state.version
    this.scheduler.schedule(roomId, version, state.nextActionAt, () =>
      this.timeout(roomId, version),
    )
  }

  /**
   * `game.davinci_code.state`는 **보는 사람 기준으로 깎은 뷰**를 그대로 싣는다.
   * 좌석마다 payload가 다르므로 한 프레임을 재사용할 수 없다.
   */
  private async broadcast(
    roomId: string,
    state: DavinciState,
    includeRoomSnapshot: boolean,
  ): Promise<void> {
    this.sendToAll(roomId, (playerId) => ({
      type: gameWsType(DAVINCI_CODE, 'state'),
      ts: this.now(),
      payload: toView(state, playerId),
      roomId,
    }))
    if (!includeRoomSnapshot) return
    const room = await this.realtimeSnapshots.snapshot(roomId)
    this.sendToAll(roomId, (playerId) => ({
      type: gameWsType(DAVINCI_CODE, 'state.sync'),
      ts: this.now(),
      payload: { snapshot: { ...room, game: toView(state, playerId) } },
      roomId,
    }))
  }

  private sendToAll(
    roomId: string,
    frame: (playerId: string) => {
      type: string
      ts: number
      payload: unknown
      roomId: string
    },
  ): void {
    for (const seat of this.audience.membersOf(roomId)) {
      if (seat.socket === null) continue
      this.audience.send(seat.socket, frame(seat.playerId))
    }
  }

  private async snapshot(
    roomId: string,
    state: DavinciState,
    viewerId: string,
  ): Promise<S & { game: DavinciView }> {
    const room = await this.realtimeSnapshots.snapshot(roomId)
    return { ...room, game: toView(state, viewerId) }
  }
}

/** 0~25의 순열. Fisher–Yates에 `crypto.randomInt`를 쓴다(예측 가능한 섞기 금지). */
const shuffledDeckOrder = (): readonly number[] => {
  const order = Array.from({ length: DAVINCI_DECK_SIZE }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    const left = order[index] as number
    const right = order[swap] as number
    order[index] = right
    order[swap] = left
  }
  return order
}
