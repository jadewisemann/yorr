/**
 * 현재 턴의 마감 시각을 **프로세스 밖에** 둔다 — deploy/PLAN.md PR 6.
 *
 * 왜 필요한가: 라운드 상태는 이미 Redis에 살아 재시작을 견디는데 **마감 시각만
 * 프로세스 인메모리 Map**이었다. 그래서 배포가 진행 중 게임을 끊었고, 부팅 때
 * `StaleRoomCleaner`가 PLAYING 방을 통째로 닫는 것이 유일한 대책이었다. 방을 열어
 * 두면 상태는 살아 있는데 턴이 넘어가지 않고 JOIN도 `game_started`로 막히는, 가장
 * 나쁜 상태가 되기 때문이다.
 *
 * **원칙 8(단일 인스턴스)은 그대로다.** 프로세스 밖으로 나가는 것은 "마감 시각"이라는
 * *데이터*이고, "누가 타이머를 발화하는가"라는 *책임*은 여전히 이 프로세스에 있다.
 * 그래서 분산 락도 pub/sub도 필요 없다(DESIGN.md 원칙 8).
 *
 * 라운드 상태(`RoundStateStore`)에 합치지 않은 이유: `RoundState`는 검증을 갖춘 도메인
 * 객체이고 그 스냅샷은 재접속 와이어 계약에 걸려 있다. 턴 시계는 `RoundTimerService`가
 * 소유하는 별개 관심사이며(도메인은 시계를 모른다), 재접속 스냅샷도 이미 라운드 상태와
 * 마감을 **따로** 받아 조립한다.
 */

export interface StoredRoundDeadline {
  readonly roundNumber: number
  /**
   * epoch ms. **null은 실패가 아니다** — 시계를 걸지 않은 턴(사람이 하나뿐인 연습 방,
   * `UNTIMED_HUMAN_LIMIT`)이라는 뜻이고 재무장도 시계 없이 해야 한다.
   */
  readonly deadline: number | null
}

/**
 * 방 하나당 기록은 **하나**다(현재 턴). 예약기와 같은 규약이다.
 *
 * 삭제는 최선 노력이다 — 게임 종료 경로 일부는 예약기만 취소하므로 기록이 TTL까지
 * 남을 수 있다. 부팅 재무장이 **방 phase와 라운드 번호를 둘 다 대조**하므로 남은
 * 기록으로 잘못된 턴을 되살리는 일은 생기지 않는다.
 */
export interface RoundDeadlineStore {
  save(roomId: string, stored: StoredRoundDeadline): Promise<void>
  find(roomId: string): Promise<StoredRoundDeadline | undefined>
  /** 라운드 번호가 **일치할 때만** 지운다(다음 턴 기록을 실수로 지우지 않게). */
  remove(roomId: string, roundNumber: number): Promise<void>
  removeRoom(roomId: string): Promise<void>
}

/**
 * 테스트용 구현.
 *
 * ⚠️ **운영 배선에 넣으면 안 된다.** 넣어도 타입이 맞고 모든 테스트가 통과하지만,
 * 그 순간 이 PR이 없앤 문제가 그대로 돌아온다(재시작마다 진행 중 게임 소실).
 * 운영은 `RedisRoundDeadlineStore`다 — `__tests__/serverWiring.test.ts`가 그것을 고정한다.
 */
export class InMemoryRoundDeadlineStore implements RoundDeadlineStore {
  private readonly deadlines = new Map<string, StoredRoundDeadline>()

  async save(roomId: string, stored: StoredRoundDeadline): Promise<void> {
    this.deadlines.set(roomId, stored)
  }

  async find(roomId: string): Promise<StoredRoundDeadline | undefined> {
    return this.deadlines.get(roomId)
  }

  async remove(roomId: string, roundNumber: number): Promise<void> {
    if (this.deadlines.get(roomId)?.roundNumber === roundNumber) this.deadlines.delete(roomId)
  }

  async removeRoom(roomId: string): Promise<void> {
    this.deadlines.delete(roomId)
  }
}
