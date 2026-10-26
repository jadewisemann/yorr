import type { DavinciRoomSnapshotPort } from './davinciPorts.js'
import type { DavinciProgress } from './davinciProgress.js'
import type { DavinciState, DavinciView } from './davinciState.js'
import type { DavinciStateStore } from './davinciStateStore.js'

/**
 * 다빈치 코드의 **재접속·재개·부팅 복구** — 상태를 읽어 스냅샷을 만들거나 마감을
 * 다시 거는 일.
 *
 * 진행(`davinciProgress.ts`)이 "상태가 바뀌었을 때"의 일이라면 여기는 "아무것도
 * 바뀌지 않았는데 방이 돌아왔을 때"의 일이다. 결투·탁구와 같은 자리다.
 */
export interface DavinciResumeDeps<S, K> {
  readonly states: DavinciStateStore
  readonly snapshots: DavinciRoomSnapshotPort<S>
  readonly progress: DavinciProgress<S, K>
}

export class DavinciResume<S, K> {
  constructor(private readonly deps: DavinciResumeDeps<S, K>) {}

  /** 상태가 없으면 방 스냅샷 그대로(대기실·이미 정리된 방). */
  async reconnect(roomId: string, playerId: string): Promise<S | (S & { game: DavinciView })> {
    const state = await this.deps.states.find(roomId)
    if (state === null) return this.deps.snapshots.snapshot(roomId)
    return this.deps.progress.snapshot(roomId, state, playerId)
  }

  /** 타이머만 되살린다 — 상태는 그대로다. 끝난 판은 예약하지 않는다. */
  async resume(roomId: string): Promise<void> {
    const state = await this.deps.states.find(roomId)
    if (state === null || state.phase === 'FINISHED') return
    this.deps.progress.schedule(roomId, state)
  }

  /**
   * 프로세스 재시작 후의 복구(옛 deploy/PLAN.md PR 6). 마감(`nextActionAt`)이 상태 안의
   * 절대 epoch ms이고 그 상태는 Redis에 있으므로 되살리는 것은 `resume`과 같은 예약이다
   * (이미 지난 마감은 예약기가 지연 0으로 깎아 즉시 발화한다).
   *
   * 이어갈 수 없으면 **던진다** — 부팅 복구에서 조용히 넘어가면 상태만 살아 있고 턴이
   * 멈춘 방이 남는다.
   */
  async rehydrate(roomId: string): Promise<void> {
    const state = await this.deps.states.find(roomId)
    if (state === null) {
      throw new Error(`진행 중이라던 방에 다빈치 코드 상태가 없습니다: ${roomId}`)
    }
    throwIfFinished(state, roomId)
    this.deps.progress.schedule(roomId, state)
  }
}

const throwIfFinished = (state: DavinciState, roomId: string): void => {
  if (state.phase === 'FINISHED') {
    throw new Error(`다빈치 코드가 이미 끝난 방입니다(종료 전이 실패): ${roomId}`)
  }
}
