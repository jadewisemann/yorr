import type { GameStartResult } from '../../room/roomService.js'
import type { WsRoomSnapshot } from '../../ws/protocol.js'
import type {
  YachtBroadcaster,
  YachtRealtimeSnapshots,
  YachtReconnectSnapshots,
  YachtRoundService,
  YachtRoundTimer,
  YachtSeatRegistry,
} from './yachtPorts.js'
import { yachtWsType } from './yachtWsTypes.js'

/**
 * 야추 모듈의 **수명주기 훅** — start/reset/reconnect/pause/resume/rehydrate/
 * removePlayer/close/hasState.
 *
 * 모듈(`yachtDiceGameModule.ts`)에서 갈라 둔 이유: 이쪽은 라운드 프레임워크 호출
 * 순서만 알고, 인바운드 메시지 라우팅은 모듈이 한다. 두 관심사가 한 클래스에 있으면
 * 순서 계약(`markPhase`가 이 자리에 있어야 하는 이유 같은)이 라우팅 코드에 묻힌다.
 */
export interface YachtLifecycleDeps {
  readonly rounds: YachtRoundService
  readonly timers: YachtRoundTimer
  readonly seats: YachtSeatRegistry
  readonly realtimeSnapshots: YachtRealtimeSnapshots<WsRoomSnapshot>
  readonly reconnectSnapshots: YachtReconnectSnapshots<WsRoomSnapshot>
  readonly broadcaster: YachtBroadcaster
}

export class YachtLifecycle {
  constructor(
    private readonly deps: YachtLifecycleDeps,
    private readonly now: () => number,
  ) {}

  /**
   * 방 phase 전이 **후** 첫 턴 준비. 순서가 계약이다:
   * 잔여 상태 제거(방어) → initialize(라운드 1, **host 우선 정렬**) →
   * 레지스트리 phase PLAYING → `state.sync` → 첫 턴 타이머.
   *
   * ⚠️ **`markPhase('playing')`이 이 자리에 있는 것이 중요하다.** 1.5·2.1이 이 구멍을
   * 열어 둔 채로 남겼다 — 레지스트리 phase를 옮기는 코드가 모듈 안에 있다.
   * 없으면 REST로 시작한 게임에 이미 붙어 있는 소켓의 phase가 `waiting`에 머물러
   * ① 끊긴 플레이어가 offline이 아니라 `room.player_left`가 되고
   * ② 재접속의 PLAYING 분기(스냅샷에 `game` 동봉)가 실전에서 도달하지 않는다.
   *
   * 실패하면 스스로 `reset`한 뒤 재throw한다 — `GameLifecycleService`가 그 예외를
   * 받아 ROLLBACK_START Lua로 방 phase까지 되돌린다.
   */
  async start(roomCode: string, game: GameStartResult): Promise<void> {
    // 이전 판의 잔여 상태가 남아 있으면 initialize가 SETNX에 걸려 시작 자체가 막힌다.
    await this.deps.rounds.remove(roomCode)
    try {
      const firstTurn = await this.deps.rounds.initialize(roomCode, 1, turnOrderOf(game))
      this.deps.seats.markPhase(roomCode, 'playing')
      await this.broadcastState(roomCode)
      await this.deps.timers.start(roomCode, firstTurn)
    } catch (error) {
      // reset이 또 던지면 그 예외가 원인을 대신 올라간다(롤백과 같은 판단).
      await this.reset(roomCode)
      throw error
    }
  }

  /** 로비 복귀 정리. 타이머 → 상태 → phase → 방송 순서가 계약이다. */
  async reset(roomCode: string): Promise<void> {
    await this.deps.timers.cancelRoom(roomCode)
    await this.deps.rounds.remove(roomCode)
    this.deps.seats.markPhase(roomCode, 'waiting')
    await this.broadcastState(roomCode)
  }

  /**
   * 재접속 스냅샷.
   *
   * ⚠️ **순서가 계약이다**: `snapshot()` → `clearOfflineMisses()`. 2.8이
   * `GameReconnectSnapshotService`에 명시해 둔 규약이며, 스냅샷 조립이 실패하면
   * 오프라인 결석 카운터가 **남는 것**이 의도된 동작이다(복귀에 실패한 사람은
   * 복귀한 것이 아니다).
   */
  async reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot> {
    const snapshot = await this.deps.reconnectSnapshots.snapshot(roomCode, playerId)
    this.deps.timers.clearOfflineMisses(roomCode, playerId)
    return snapshot
  }

  /** 타이머만 끊는다 — 진행 상태는 남긴다(새로고침으로 돌아올 수 있다). */
  async pause(roomCode: string): Promise<void> {
    await this.deps.timers.cancelRoom(roomCode)
  }

  /**
   * **미완료 상태가 있을 때만** 타이머를 재무장한다. 끝난 게임을 되살리지 않는다.
   *
   * 여기서 `start`를 부르는 것(= 새 25초)이 의도다. 이 경로는 "모두 접속이 끊겨
   * 시계를 멈춰 둔 방에 누가 돌아왔다"이고, 멈춰 둔 시계를 원래 마감으로 되살리면
   * 돌아온 사람의 턴이 그 자리에서 만료된다. 재시작 복구는 `rehydrate`가 맡는다.
   */
  async resume(roomCode: string): Promise<void> {
    const state = await this.deps.rounds.findByRoomId(roomCode)
    if (state === undefined || state.finished) return
    await this.deps.timers.start(roomCode, state)
  }

  /**
   * 프로세스 재시작 후의 복구(PR 6). **저장된 마감을 그대로 되살린다.**
   *
   * 이어갈 수 없는 세 경우는 전부 던진다 — 호출자가 그 방만 닫는다:
   * ① 라운드 상태가 없다(진행 중이라던 방에 게임이 없다),
   * ② 라운드 상태가 이미 끝났다(종료 전이가 실패한 채 남은 방이다),
   * ③ 저장된 마감이 없거나 라운드 번호가 어긋난다.
   */
  async rehydrate(roomCode: string): Promise<void> {
    const state = await this.deps.rounds.findByRoomId(roomCode)
    if (state === undefined) {
      throw new Error(`진행 중이라던 방에 야추 라운드 상태가 없습니다: ${roomCode}`)
    }
    if (state.finished) {
      throw new Error(`야추 라운드가 이미 끝난 방입니다(종료 전이 실패): ${roomCode}`)
    }
    if (!(await this.deps.timers.resumeFromStored(roomCode, state))) {
      throw new Error(`되살릴 턴 마감 기록이 없습니다: ${roomCode}`)
    }
  }

  /** 게임 중 이탈 — 명단·턴 순서·다음 턴 판단은 전부 타이머의 단일 경로에 있다. */
  async removePlayer(roomCode: string, playerId: string): Promise<void> {
    await this.deps.timers.removePlayer(roomCode, playerId)
  }

  /** 방 소멸. 여기서는 phase를 옮기지 않는다(방 자체가 사라진다). */
  async close(roomCode: string): Promise<void> {
    await this.deps.timers.cancelRoom(roomCode)
    await this.deps.rounds.remove(roomCode)
  }

  /** 진행 중 게임 존재 여부 — 빈 방 유예 30초/10분 선택의 근거. */
  async hasState(roomCode: string): Promise<boolean> {
    return (await this.deps.rounds.findByRoomId(roomCode)) !== undefined
  }

  private async broadcastState(roomCode: string): Promise<void> {
    const snapshot = await this.deps.realtimeSnapshots.snapshot(roomCode)
    this.deps.broadcaster.broadcast(roomCode, {
      type: yachtWsType('state.sync'),
      ts: this.now(),
      payload: { snapshot },
      roomId: roomCode,
    })
  }
}

/**
 * 턴 순서 = **host 우선, 나머지는 Redis 명단 순서 유지**(안정 정렬의
 * 안정 정렬 자리 — `Array.prototype.sort`도 안정 정렬이다).
 */
const turnOrderOf = (game: GameStartResult): string[] =>
  [...game.snapshot.players]
    .sort(
      (left, right) =>
        hostRank(left.playerId, game.snapshot.hostId) -
        hostRank(right.playerId, game.snapshot.hostId),
    )
    .map((player) => player.playerId)

const hostRank = (playerId: string, hostId: string | null): number => (playerId === hostId ? 0 : 1)
