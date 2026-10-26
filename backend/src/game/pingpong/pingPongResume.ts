import type { PingPongStateStore } from './pingPongPorts.js'
import type { PingPongProgress } from './pingPongProgress.js'
import { isPingPongFinished } from './pingPongState.js'

/**
 * 탁구의 **재접속·재개·부팅 복구** — 상태를 읽어 스냅샷을 만들거나 마감을 다시 거는 일.
 *
 * 진행(`pingPongProgress.ts`)이 "상태가 바뀌었을 때"의 일이라면 여기는 "아무것도
 * 바뀌지 않았는데 방이 돌아왔을 때"의 일이다. 둘 다 스케줄러·스냅샷을 쓰지만 계기가
 * 다르고, 한 클래스에 두면 읽는 사람이 두 경우를 번갈아 붙잡아야 한다.
 */
export interface PingPongResumeDeps<S extends object> {
  readonly states: PingPongStateStore
  readonly progress: PingPongProgress<S>
}

export class PingPongResume<S extends object> {
  constructor(private readonly deps: PingPongResumeDeps<S>) {}

  /** 진행 중이면 게임 상태를 `game` 필드에 실은 스냅샷, 아니면 방 스냅샷 그대로. */
  async reconnect(roomId: string): Promise<S> {
    const state = await this.deps.states.find(roomId)
    return state === undefined
      ? this.deps.progress.roomSnapshot(roomId)
      : this.deps.progress.gameSnapshot(roomId, state)
  }

  /** 타이머만 되살린다 — 상태는 그대로다. 끝난 판은 다시 걸지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.deps.states.find(roomId)
    if (state === undefined || isPingPongFinished(state)) return
    await this.deps.progress.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(옛 deploy/PLAN.md PR 6).
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
    await this.deps.progress.schedule(roomId, state)
  }
}
