import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ConflictError } from '../../errors.js'
import { type Redis, UNLOCK_IF_OWNER } from '../../infra/memoryRedis.js'

/**
 * 야추 상태 저장소의 **방 락** — SET NX PX + 스핀 + 토큰 비교 해제.
 *
 * 스토어(`redisYachtDiceStateStore.ts`)에서 갈라 둔 이유: 이쪽은 키 이름과 락
 * 프로토콜만 알고, 상태 스냅샷의 직렬화·검증을 모른다. 락을 조정할 때(대기 예산·
 * 재시도 간격·해제 스크립트) 상태 전이 코드를 지나치지 않게 한다.
 *
 * 해제는 `finally`에서 **항상** 시도한다 — 락을 못 잡고 나가는 경로에서도 토큰이
 * 다르므로 no-op이다(그게 토큰 비교의 두 번째 역할이다).
 */
export interface RoomLockOptions {
  readonly lockTtlMs: number
  readonly lockWaitMs: number
  readonly lockRetryMs: number
  readonly now: () => number
}

export class RoomLock {
  constructor(
    private readonly redis: Redis,
    private readonly options: RoomLockOptions,
  ) {}

  /**
   * `keyPrefix`에 `:lock`을 붙여 잠근다. 접미사를 여기서 붙이는 이유: 잠금 키 규칙이
   * 한 곳(이 클래스)에만 있어야 "어느 모듈이 잠금을 쓰는가"를 셀 때 오해가 없다.
   */
  async withLock<T>(keyPrefix: string, action: () => Promise<T>): Promise<T> {
    const lockKey = `${keyPrefix}:lock`
    const token = randomUUID()
    const deadline = this.options.now() + this.options.lockWaitMs
    try {
      while ((await this.redis.set(lockKey, token, 'PX', this.options.lockTtlMs, 'NX')) !== 'OK') {
        if (this.options.now() >= deadline) throw new ConflictError('game_state_busy')
        await delay(this.options.lockRetryMs)
      }
      return await action()
    } finally {
      await this.redis.runAtomic(UNLOCK_IF_OWNER, [lockKey], [token]).catch(() => {
        // 해제 실패는 삼킨다 — TTL이 같은 일을 한다. 여기서 던지면 정상 처리된
        // 전이의 결과를 잃는다.
      })
    }
  }
}
