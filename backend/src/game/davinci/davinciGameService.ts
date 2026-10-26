import { DomainError } from '../../errors.js'
import {
  orderedPlayerIds,
  requireDecidePayload,
  requireGuessPayload,
  requirePlacePayload,
  shuffledDeckOrder,
} from './davinciInput.js'
import type {
  DavinciAudience,
  DavinciCompletionPort,
  DavinciDeadlineScheduler,
  DavinciPresence,
  DavinciRoomSnapshotPort,
  DavinciScoreboardPort,
} from './davinciPorts.js'
import { DavinciProgress } from './davinciProgress.js'
import { DavinciResume } from './davinciResume.js'
import {
  decide as applyDecide,
  guess as applyGuess,
  place as applyPlace,
  type DavinciDecision,
  expire,
  forfeit,
  initialDavinciState,
  isGuessableNumber,
} from './davinciRules.js'
import type { DavinciState, DavinciView } from './davinciState.js'
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
  private readonly presence: DavinciPresence
  private readonly now: () => number
  private readonly shuffle: () => readonly number[]
  private readonly progress: DavinciProgress<S, K>
  private readonly resumeService: DavinciResume<S, K>

  constructor(deps: DavinciGameServiceDeps<S, K>, options: DavinciGameServiceOptions = {}) {
    this.states = deps.states
    this.scheduler = deps.scheduler
    this.presence = deps.presence
    this.now = options.now ?? Date.now
    this.shuffle = options.shuffle ?? shuffledDeckOrder
    this.progress = new DavinciProgress<S, K>(
      {
        scheduler: deps.scheduler,
        audience: deps.audience,
        snapshots: deps.realtimeSnapshots,
        scoreboard: deps.scoreboard,
        completion: deps.completion,
      },
      this.now,
      (roomId, expectedVersion) => this.timeout(roomId, expectedVersion),
    )
    this.resumeService = new DavinciResume<S, K>({
      states: deps.states,
      snapshots: deps.realtimeSnapshots,
      progress: this.progress,
    })
  }

  /**
   * 상태 초기화 + 첫 턴 마감 예약. **호스트가 playerOrder[0]** 이고 첫 턴을 가진다.
   *
   * 봇은 명단에서 걸러낸다. 카탈로그가 `supportsBots: false`로 막지만 여기서 한 번 더
   * 확인해 2~4인이 아니면 시작을 거부한다(라이프사이클이 그 예외로 START를 롤백한다).
   */
  async start(roomId: string, roster: DavinciStartRoster): Promise<void> {
    const state = initialDavinciState(orderedPlayerIds(roster), this.shuffle(), this.now())
    await this.states.initialize(roomId, state)
    this.presence.markPhase(roomId, 'playing')
    await this.progress.broadcast(roomId, state, true)
    this.progress.schedule(roomId, state)
  }

  /** 상대 타일 하나의 숫자를 부른다. payload 검증만 여기서 하고 판정은 규칙이 한다. */
  async guess(roomId: string, playerId: string, payload: DavinciGuessPayload): Promise<void> {
    requireGuessPayload(payload)
    if (!isGuessableNumber(payload.number)) throw new DomainError('invalid_davinci_guess')
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyGuess(current, {
        playerId,
        inputSeq: payload.inputSeq,
        targetId: payload.targetId,
        tileId: payload.tileId,
        number: payload.number,
        now,
      }),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 맞힌 뒤의 선택 — 이어서 부를지, 멈추고 턴을 넘길지. */
  async decide(roomId: string, playerId: string, payload: DavinciDecidePayload): Promise<void> {
    requireDecidePayload(payload)
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyDecide(current, {
        playerId,
        inputSeq: payload.inputSeq,
        decision: payload.decision,
        now,
      }),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 조커를 놓을 자리를 정한다. */
  async place(roomId: string, playerId: string, payload: DavinciPlacePayload): Promise<void> {
    requirePlacePayload(payload)
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) =>
      applyPlace(current, {
        playerId,
        inputSeq: payload.inputSeq,
        index: payload.index,
        now,
      }),
    )
    if (next !== null) await this.changed(roomId, next)
  }

  /** 재접속 스냅샷 — `davinciResume.ts`가 맡는다. */
  async reconnect(roomId: string, playerId: string): Promise<DavinciSnapshot<S>> {
    return this.resumeService.reconnect(roomId, playerId)
  }

  async resume(roomId: string): Promise<void> {
    return this.resumeService.resume(roomId)
  }

  async rehydrate(roomId: string): Promise<void> {
    return this.resumeService.rehydrate(roomId)
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
    await this.progress.changed(roomId, state)
  }
}
