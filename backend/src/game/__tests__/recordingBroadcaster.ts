/**
 * 방으로 나간 봉투를 그대로 쌓아 두는 브로드캐스터 대역.
 *
 * 게임마다 봉투 타입이 다르므로 제네릭으로 둔다. 각 게임의 대역은 이 클래스를
 * 자기 봉투 타입으로 확장해 그 게임의 브로드캐스터 포트를 만족시킨다 — 포트가
 * 구조적으로 같은 모양이라 어댑터 없이 대입된다.
 */
export class BroadcastRecorder<E extends { readonly type: string }> {
  readonly sent: { readonly roomId: string; readonly message: E }[] = []

  broadcast(roomId: string, message: E): void {
    this.sent.push({ roomId, message })
  }

  /** 준비 단계의 방송을 지운다. 검사가 보려는 것은 그 다음에 나간 것들이다. */
  reset(): void {
    this.sent.length = 0
  }

  messagesFor(roomId: string): E[] {
    return this.sent.filter((entry) => entry.roomId === roomId).map((entry) => entry.message)
  }

  typesFor(roomId: string): string[] {
    return this.messagesFor(roomId).map((message) => message.type)
  }
}
