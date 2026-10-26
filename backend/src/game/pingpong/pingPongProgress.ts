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
import { isPingPongFinished, type PingPongState } from './pingPongState.js'

/**
 * 탁구 상태가 바뀐 **뒤의 일** — 방송, 마감 예약, 종료 정산, 방 정리.
 *
 * 규칙(`pingPongRules.ts`)도 입력 판정(`pingPongGameService.ts`)도 아닌 세 번째
 * 관심사다. "공과 점수가 어떻게 흐르는가"와 "그 사실을 방에 어떻게 알리고 마감을
 * 언제 다시 거는가"를 한 클래스에 두면 읽는 사람이 둘을 번갈아 붙잡아야 하고,
 * 파일 단위 할스테드 난이도도 상한을 넘는다.
 *
 * 종료 순서가 계약이다: 예약 취소 → 점수 기록 → `finishIfComplete(force=true)` →
 * 방송. 점수를 종료 판정보다 **먼저** 써야 `game.over`의 순위가 최종 점수를 본다.
 */
export interface PingPongProgressDeps<S extends object> {
  readonly scheduler: PingPongDeadlineScheduler
  readonly broadcaster: PingPongBroadcaster
  readonly snapshots: PingPongSnapshotService<S>
  readonly presence: PingPongPresence
  readonly rooms: PingPongRoomService
  readonly completion: PingPongCompletionPort
  readonly scoreWriter: PingPongScoreWriter
  readonly states: PingPongStateStore
}

export class PingPongProgress<S extends object> {
  constructor(
    private readonly deps: PingPongProgressDeps<S>,
    private readonly now: () => number,
    /** 마감이 발화했을 때 부를 것 — 서비스가 자기 전이를 꽂는다. */
    private readonly onExpire: (roomId: string, expectedVersion: number) => void | Promise<void>,
  ) {}

  /**
   * 방마다 "이 판의 랠리를 대시보드가 판정하는가"(frontend ADR-0003).
   *
   * **판이 시작될 때 한 번 정하고 끝날 때까지 유지한다.** 매번 Redis를 읽지 않는 이유가
   * 성능만은 아니다 — 판정 주체가 판 도중에 바뀌면 같은 랠리를 둘이 판정하는 순간이 생긴다.
   * 방이 끝나거나 대기실로 돌아갈 때 지운다.
   */
  private readonly hostJudged = new Map<string, boolean>()

  /**
   * 처음 물을 때 한 번 읽고 캐시한다 — 캐시가 있으면 Redis를 다시 보지 않으므로
   * **판 도중에 판정 주체가 바뀌지 않는다.**
   */
  async isHostJudged(roomId: string): Promise<boolean> {
    const cached = this.hostJudged.get(roomId)
    if (cached !== undefined) return cached
    const party = await this.deps.rooms.isPartyRoom(roomId)
    this.hostJudged.set(roomId, party)
    return party
  }

  /**
   * 상태가 바뀐 뒤의 공통 후처리.
   *
   * COUNTDOWN 진입에만 방 스냅샷을 동봉한다 — 클라이언트가 점수판·명단을 다시
   * 맞추는 지점이 득점 직후이기 때문이고, 랠리 중 매 스윙마다 방 스냅샷을 실으면
   * 프레임마다 Redis를 읽게 된다.
   */
  async changed(roomId: string, state: PingPongState): Promise<void> {
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
   * 마감 예약. **대시보드가 판정하는 판에는 걸지 않는다** — 걸어 두면 서버가 자기
   * 시뮬레이션으로 공을 넘기고 점수를 내고 `game.over`까지 만들어, 전적에 틀린 결과가
   * 남는다(frontend ADR-0003 「기각한 대안」).
   */
  async schedule(roomId: string, state: PingPongState): Promise<void> {
    if (await this.isHostJudged(roomId)) return
    if (isPingPongFinished(state) || state.nextActionAt <= 0) return
    this.deps.scheduler.schedule(roomId, state.version, state.nextActionAt, () =>
      this.onExpire(roomId, state.version),
    )
  }

  /**
   * 예약과 판정 주체 캐시만 버린다 — 상태 삭제·로비 복귀 방송은 호출자가 순서를
   * 정한다(로비 복귀와 매치 취소가 서로 다른 뒷정리를 하기 때문이다).
   */
  stop(roomId: string): void {
    this.deps.scheduler.cancelRoom(roomId)
    this.hostJudged.delete(roomId)
  }

  /**
   * 대시보드가 판정하는 판에서 폰의 스윙을 **판정 없이 방에 그대로 넘긴다**.
   *
   * 링크가 없는 폰의 스윙이 도착하는 유일한 경로라, 이것이 있어야 링크 없이도 파티
   * 탁구가 성립한다. 방 전체 방송인 이유: 대시보드를 서버가 특정하려면 명단에 없는
   * 멤버를 뒤져야 하는데, 컨트롤러는 이 메시지를 무시하면 그만이라 방송이 더 싸다.
   */
  relaySwing(
    roomId: string,
    playerId: string,
    payload: { readonly inputSeq: number; readonly clientTs: number },
  ): void {
    this.deps.broadcaster.broadcast(
      roomId,
      this.envelope(
        'game.ping_pong.swung',
        { playerId, inputSeq: payload.inputSeq, clientTs: payload.clientTs },
        roomId,
      ),
    )
  }

  /** 게임 상태 없이 방 스냅샷만 — 취소·로비 복귀 경로가 쓴다. */
  async syncRoom(roomId: string): Promise<void> {
    this.deps.broadcaster.broadcast(
      roomId,
      this.envelope(
        gameWsType(PING_PONG, 'state.sync'),
        { snapshot: await this.roomSnapshot(roomId) },
        roomId,
      ),
    )
  }

  /** 방 스냅샷 그대로 — 게임 상태를 얹지 않는다. */
  async roomSnapshot(roomId: string): Promise<S> {
    return this.deps.snapshots.snapshot(roomId)
  }

  async broadcast(
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

  async gameSnapshot(roomId: string, state: PingPongState): Promise<S> {
    const room = await this.deps.snapshots.snapshot(roomId)
    return { ...room, game: state }
  }

  envelope(type: string, payload: unknown, roomId: string): PingPongOutboundEnvelope {
    return { type, ts: this.now(), payload, roomId }
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
  async leave(
    roomId: string,
    playerId: string,
    forfeit: (state: PingPongState, playerId: string, now: number) => PingPongState,
  ): Promise<void> {
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
    this.stop(roomId)
    await this.deps.states.remove(roomId)
    this.deps.presence.markPhase(roomId, 'waiting')
    await this.syncRoom(roomId)
  }

  async close(roomId: string): Promise<void> {
    this.stop(roomId)
    await this.deps.states.remove(roomId)
  }

  /**
   * PREPARING 이탈 → 매치 취소. `reset`과 달리 **START가 세운 gameId까지 되돌린다**
   * (`cancelActiveGame`) — 그러지 않으면 대기실로 돌아간 방에 죽은 gameId가 남아
   * 다음 시작이 막힌다.
   */
  private async cancelPreparation(roomId: string): Promise<void> {
    this.stop(roomId)
    await this.deps.states.remove(roomId)
    await this.deps.rooms.cancelActiveGame(roomId)
    this.deps.presence.markPhase(roomId, 'waiting')
    await this.syncRoom(roomId)
  }
}
