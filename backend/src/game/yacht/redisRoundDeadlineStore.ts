import type { Redis } from 'ioredis'
import { roomKey } from '../../room/keys.js'
import { YACHT_DICE } from '../catalog.js'
import type { RoundDeadlineStore, StoredRoundDeadline } from '../round/index.js'

/**
 * 턴 마감 시각의 운영 저장소 — deploy/PLAN.md PR 6.
 *
 * 키 스킴은 라운드 상태 키와 같은 가족이다(`room:{code}:game:YACHT_DICE:…`) —
 * 같은 방의 게임 데이터가 한 접두사 아래 모여 있어야 진단할 때 헤매지 않는다.
 *
 * TTL은 **독립적으로 걸지 않는다.** 쓸 때마다 방 키의 남은 PTTL을 복사한다
 * (`RedisYachtDiceStateStore`와 같은 규약): 방보다 오래 사는 마감은 고아이고, 방보다
 * 먼저 죽는 마감은 진행 중 게임의 시계를 잃는다. 방에 TTL이 없으면 아무것도 하지
 * 않는다 — 그 경우 라운드 상태 키와 함께 스위퍼(2.8)의 회수 대상이 된다.
 */
export class RedisRoundDeadlineStore implements RoundDeadlineStore {
  constructor(private readonly redis: Redis) {}

  async save(roomId: string, stored: StoredRoundDeadline): Promise<void> {
    validateRoomId(roomId)
    // 값은 두 필드짜리 JSON이다. 마감이 없는 턴(연습 방)은 `deadline: null`이며,
    // **키가 없는 것과 뜻이 다르다** — 키가 없으면 "이 방에 진행 중인 턴이 없다"다.
    await this.redis.set(deadlineKey(roomId), JSON.stringify(stored))
    await this.copyRoomTtl(roomId)
  }

  async find(roomId: string): Promise<StoredRoundDeadline | undefined> {
    validateRoomId(roomId)
    const raw = await this.redis.get(deadlineKey(roomId))
    if (raw === null) return undefined
    return parseStored(raw)
  }

  async remove(roomId: string, roundNumber: number): Promise<void> {
    validateRoomId(roomId)
    // 읽고 비교한 뒤 지운다. 원자성이 필요 없는 이유: 이 프로세스가 유일한 기록자이고
    // (원칙 8) 전이가 전부 같은 이벤트 루프에서 일어난다. 설령 어긋나도 재무장이
    // 라운드 번호를 다시 대조하므로 잘못된 턴이 되살아나지 않는다.
    const current = await this.find(roomId)
    if (current?.roundNumber === roundNumber) await this.removeRoom(roomId)
  }

  async removeRoom(roomId: string): Promise<void> {
    validateRoomId(roomId)
    await this.redis.del(deadlineKey(roomId))
  }

  private async copyRoomTtl(roomId: string): Promise<void> {
    const ttl = await this.redis.pttl(roomKey(roomId))
    if (ttl > 0) await this.redis.pexpire(deadlineKey(roomId), ttl)
  }
}

const deadlineKey = (roomId: string): string => `${roomKey(roomId)}:game:${YACHT_DICE}:deadline`

/**
 * 손상된 값은 **없는 것으로 다룬다.** 던지면 부팅 재무장 전체가 한 방 때문에 멈추는데,
 * 여기서 undefined를 내면 그 방만 fail-closed로 닫힌다(PR 6의 정책).
 */
const parseStored = (raw: string): StoredRoundDeadline | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { roundNumber, deadline } = parsed as Record<string, unknown>
    if (typeof roundNumber !== 'number' || !Number.isFinite(roundNumber)) return undefined
    if (deadline === null) return { roundNumber, deadline: null }
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) return undefined
    return { roundNumber, deadline }
  } catch {
    return undefined
  }
}

const validateRoomId = (roomId: string): void => {
  if (roomId.trim().length === 0) throw new Error('roomId must not be blank')
}
