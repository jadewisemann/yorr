/**
 * `RedisCore`의 상태와 접근 원시 연산. 명령 구현은 타입별 파일(`redisStrings.ts`·
 * `redisHashes.ts`·`redisZsets.ts`·`redisKeyCommands.ts`)에 있고, 스냅샷은
 * `redisSnapshot.ts`에 있다. 여기에는 **값을 꺼내고 넣는 규칙**만 둔다.
 *
 * 이 클래스의 메서드는 infra 내부 계약이다 — 바깥 코드는 `RedisCore`(명령)를 쓴다.
 * 만료 확인·키 상한·스크립트 선언 검사처럼 **모든 명령이 같이 지켜야 하는 규칙**이
 * 여기 모여 있으므로, 명령 파일이 늘어도 규칙은 한 벌이다.
 */

import { restoreInto, snapshotOf, sweepExpired } from './redisSnapshot.js'
import {
  DEFAULT_MAX_KEYS,
  type Entry,
  OOM_MESSAGE,
  type SnapshotEntry,
  WRONGTYPE,
} from './redisTypes.js'

/** 비어 버린 해시·정렬 집합은 키째 지운다 — Redis와 같다. */
export function dropIfEmpty(
  store: RedisKeyspace,
  key: string,
  container: Map<string, unknown>,
): void {
  if (container.size === 0) store.data.delete(key)
}

export class RedisKeyspace {
  /** 키 공간. 명령 파일이 직접 읽고 쓰되, 새 키는 반드시 `create`를 거친다. */
  readonly data = new Map<string, Entry>()

  constructor(
    readonly now: () => number = Date.now,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {}

  /**
   * 원자적 스크립트를 도는 동안 그 스크립트가 만들어도 되는 키들. 상한은 실행 **전에**
   * 이미 판정했으므로(`runAdmitted`) 이 키들은 상한 없이 만든다. 이 밖의 키를 만들면
   * 선언이 틀린 것이다.
   */
  private scriptCreates: { readonly script: string; readonly keys: ReadonlySet<string> } | null =
    null

  /** 만료됐으면 지우고 undefined. 살아 있으면 그대로. */
  live(key: string): Entry | undefined {
    const entry = this.data.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.data.delete(key)
      return undefined
    }
    return entry
  }

  /** 타입이 다른 키에 명령을 보내면 Redis처럼 `WRONGTYPE`이다. */
  hash(key: string): Map<string, string> | undefined {
    const entry = this.live(key)
    if (entry === undefined) return undefined
    if (entry.type !== 'hash') throw new Error(WRONGTYPE)
    return entry.value
  }

  zset(key: string): Map<string, number> | undefined {
    const entry = this.live(key)
    if (entry === undefined) return undefined
    if (entry.type !== 'zset') throw new Error(WRONGTYPE)
    return entry.value
  }

  string(key: string): string | null {
    const entry = this.live(key)
    if (entry === undefined) return null
    if (entry.type !== 'string') throw new Error(WRONGTYPE)
    return entry.value
  }

  hashForWrite(key: string): Map<string, string> {
    const existing = this.hash(key)
    if (existing !== undefined) return existing
    const value = new Map<string, string>()
    this.create(key, { type: 'hash', value })
    return value
  }

  /**
   * **새** 키를 만든다. 상한에 닿으면 만료 키를 먼저 회수하고, 그래도 넘으면 거절한다
   * (`noeviction`). 이미 있는 키를 덮어쓰는 것은 키 수를 늘리지 않으므로 막지 않는다.
   */
  create(key: string, entry: Entry): void {
    if (this.scriptCreates !== null && !this.data.has(key)) {
      if (!this.scriptCreates.keys.has(key)) {
        throw new Error(
          `${this.scriptCreates.script}: 만든다고 선언하지 않은 키를 만들었다 — ${key}`,
        )
      }
      this.data.set(key, entry)
      return
    }
    if (!this.data.has(key) && this.data.size >= this.maxKeys) {
      this.sweep()
      if (this.data.size >= this.maxKeys) throw new Error(OOM_MESSAGE)
    }
    this.data.set(key, entry)
  }

  /**
   * 스크립트를 들이기 전에 상한을 판정한다. 스크립트가 **새로 만들 수 있다고 선언한 키** 중 아직 없는
   * 것만큼 자리가 있어야 하고, 없으면 아무것도 쓰기 전에 던진다 — 쓰다가 중간에 OOM으로 멈추면 앞의
   * 쓰기만 남는다(점수 행 없는 참가자, 제출 이력 없는 점수). 새 키를 만들지 않는 스크립트(LEAVE 등)는
   * 상한에서도 돈다 — 나가서 자리를 비울 수 있어야 한다. 들인 스크립트는 끝까지 돈다(Redis도 쓰기를
   * 시작한 스크립트는 끝낸다).
   */
  runAdmitted<R>(script: string, creatable: readonly string[], run: () => R): R {
    const missing = new Set(creatable.filter((key) => this.live(key) === undefined)).size
    if (missing > 0 && this.data.size + missing > this.maxKeys) {
      this.sweep()
      if (this.data.size + missing > this.maxKeys) throw new Error(OOM_MESSAGE)
    }
    this.scriptCreates = { script, keys: new Set(creatable) }
    try {
      return run()
    } finally {
      this.scriptCreates = null
    }
  }

  /** 상한 판정에 쓰는 값. 스냅샷 복원이 읽는다. */
  get capacity(): number {
    return this.maxKeys
  }

  // ── 스냅샷 ────────────────────────────────────────────────────────────────

  snapshot(): SnapshotEntry[] {
    return snapshotOf(this)
  }

  restore(raw: readonly unknown[]): number {
    return restoreInto(this, raw)
  }

  sweep(): number {
    return sweepExpired(this)
  }
}
