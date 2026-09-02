/**
 * 마감 시각을 **상태 안에** 지닌 게임의 진행 뼈대.
 *
 * 결투와 다빈치 코드는 같은 모양으로 돈다: 순수 규칙 함수가 상태를 옮기고, 옮겨진
 * 상태의 `nextActionAt`이 다음 마감이며, 그 마감이 오면 다시 규칙 함수를 부른다. 그래서
 * 재접속·복구·이탈·정리처럼 **규칙과 무관한 배선**은 두 서비스가 글자까지 같았다
 * (ADR-0007이 모듈 층에서 한 일을 서비스 층에서 하는 셈이다).
 *
 * 여기 두지 않은 것은 게임마다 다른 것들이다 — 방송 봉투의 모양, 종료 시 점수 산정,
 * 로비 복귀 시 무엇을 다시 뿌리는지. 그것들은 각 서비스에 남는다.
 *
 * 탁구는 이 뼈대를 쓰지 않는다. 상태를 `undefined`로 비우고 예약이 비동기이며 이탈이
 * 좌석·방 정리까지 함께 하므로, 억지로 맞추면 갈래가 늘어 오히려 읽기 어려워진다.
 */

/** 버전과 마감을 지닌 진행 상태. `phase`가 `'FINISHED'`면 더 예약하지 않는다. */
export interface ScheduledGameState {
  readonly version: number
  readonly phase: string
  /** 다음 마감(절대 epoch ms). 0 이하면 예약할 마감이 없다는 뜻이다. */
  readonly nextActionAt: number
}

export interface ScheduledStateStore<S extends ScheduledGameState> {
  find(roomId: string): Promise<S | null>
  mutate(roomId: string, mutation: (current: S) => S | null): Promise<S | null>
  remove(roomId: string): Promise<unknown>
}

export interface RoomDeadlineScheduler {
  schedule(
    roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void
  cancelRoom(roomId: string): unknown
}

const FINISHED = 'FINISHED'

export abstract class ScheduledStateGameService<S extends ScheduledGameState> {
  protected abstract readonly states: ScheduledStateStore<S>
  protected abstract readonly scheduler: RoomDeadlineScheduler
  /** 복구 실패 문구에 쓰는 게임 이름("결투"·"다빈치 코드"). */
  protected abstract readonly gameLabel: string
  protected abstract readonly now: () => number

  /** 상태가 실제로 바뀐 뒤의 뒷일 — 방송·재예약·종료 처리. */
  protected abstract changed(roomId: string, state: S): Promise<void>

  /** 마감이 왔다. 기대 버전이 어긋나면 아무것도 하지 않는 것이 이 뼈대의 전제다. */
  protected abstract timeout(roomId: string, expectedVersion: number): Promise<void>

  /** 게임 중 이탈을 상태에 적용하는 순수 규칙 함수. */
  protected abstract forfeit(state: S, playerId: string, now: number): S | null

  /** 타이머만 되살린다 — 상태는 그대로다. 끝난 판은 예약하지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null || state.phase === FINISHED) return
    this.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(deploy/PLAN.md PR 6). 마감이 상태 안의 절대 epoch ms이고
   * 그 상태는 Redis에 있으므로, 되살리는 것은 `resume`과 같은 예약이다(이미 지난 마감은
   * 예약기가 지연 0으로 깎아 즉시 발화한다).
   *
   * `resume`과 다른 점은 **이어갈 수 없으면 던진다**는 것뿐이다 — 부팅 복구에서 조용히
   * 넘어가면 상태만 살아 있고 턴이 멈춘 방이 남는다.
   */
  async rehydrate(roomId: string): Promise<void> {
    const state = await this.states.find(roomId)
    if (state === null) {
      throw new Error(`진행 중이라던 방에 ${this.gameLabel} 상태가 없습니다: ${roomId}`)
    }
    if (state.phase === FINISHED) {
      throw new Error(`${this.gameLabel}가 이미 끝난 방입니다(종료 전이 실패): ${roomId}`)
    }
    this.schedule(roomId, state)
  }

  async pause(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
  }

  /**
   * 게임 중 이탈 — **forfeit만 적용한다.** 레지스트리·roster 제거는 호출자(WS
   * 게이트웨이·라이프사이클) 몫이다.
   */
  async removePlayer(roomId: string, playerId: string): Promise<void> {
    const now = this.now()
    const next = await this.states.mutate(roomId, (current) => this.forfeit(current, playerId, now))
    if (next !== null) await this.changed(roomId, next)
  }

  async close(roomId: string): Promise<void> {
    this.scheduler.cancelRoom(roomId)
    await this.states.remove(roomId)
  }

  async hasState(roomId: string): Promise<boolean> {
    return (await this.states.find(roomId)) !== null
  }

  protected schedule(roomId: string, state: S): void {
    if (state.phase === FINISHED || state.nextActionAt <= 0) return
    const version = state.version
    this.scheduler.schedule(roomId, version, state.nextActionAt, () =>
      this.timeout(roomId, version),
    )
  }
}
