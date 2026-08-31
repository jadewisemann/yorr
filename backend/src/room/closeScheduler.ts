/**
 * "방이 비었으니 잠시 뒤 닫는다"를 예약한다. 방 하나당 예약은 하나이며 다시
 * 예약하면 교체된다.
 *
 * 즉시 닫지 않는 이유: 새로고침은 소켓을 끊고 다시 연결하는 동작이라 마지막
 * 참가자가 새로고침하는 순간 방이 비어 보인다. 그때 바로 닫으면 본인이 자기
 * 방을 파괴한다.
 */
export interface RoomCloseScheduler {
  schedule(roomId: string, delayMs: number, closeTask: () => void | Promise<void>): void

  /** @returns 실제로 취소할 예약이 있었는지. 호출자는 이 값으로 "복귀"를 판별한다. */
  cancel(roomId: string): boolean
}

/** 단일 인스턴스 전제 어댑터. 분산이 필요해지면 여기만 갈아끼운다. */
export class InMemoryRoomCloseScheduler implements RoomCloseScheduler {
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(private readonly onError: (error: unknown, roomId: string) => void = () => {}) {}

  schedule(roomId: string, delayMs: number, closeTask: () => void | Promise<void>): void {
    if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
    this.cancel(roomId)
    const timer = setTimeout(
      () => {
        // 자기 예약만 지운다. 그 사이 새 예약이 들어왔으면 그쪽을 살려둬야 한다.
        if (this.pending.get(roomId) === timer) this.pending.delete(roomId)
        void (async () => {
          try {
            await closeTask()
          } catch (error) {
            this.onError(error, roomId)
          }
        })()
      },
      Math.max(0, delayMs),
    )
    timer.unref()
    this.pending.set(roomId, timer)
  }

  cancel(roomId: string): boolean {
    const timer = this.pending.get(roomId)
    if (!timer) return false
    clearTimeout(timer)
    this.pending.delete(roomId)
    return true
  }

  stop(): void {
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }
}
