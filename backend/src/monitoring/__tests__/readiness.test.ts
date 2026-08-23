import { describe, expect, it, vi } from 'vitest'
import {
  mysqlReadinessCheck,
  READINESS_CACHE_MS,
  type ReadinessCheck,
  type ReadinessFailure,
  type ReadinessResult,
  ReadinessService,
  redisReadinessCheck,
} from '../readiness.js'

/**
 * `/actuator/health`가 무엇을 증명하는지 고정한다.
 *
 * 예전 구현은 상수 `{status:'UP'}`이었고, 그 상태에서는 Redis·MySQL이 둘 다 죽어도
 * 배포 게이트(`up -d --wait`)와 컨테이너 `HEALTHCHECK`가 초록이었다. 그래서 이
 * 스위트의 판정 기준은 "확인을 부르는가"가 아니라 **"확인이 실패하면 DOWN이 되는가"** 다.
 */

/** 실패 이유의 메시지. 확인이 없었으면 단정이 그 자리에서 깨지게 빈 문자열을 낸다. */
const reasonOf = (failure: ReadinessFailure | undefined): string =>
  failure?.reason instanceof Error ? failure.reason.message : ''

/** 호출 횟수를 세는 확인. 캐시·동시 호출 합류를 보는 데 쓴다. */
const countingCheck = (name: string, outcome: 'ok' | 'fail' = 'ok') => {
  let calls = 0
  const check: ReadinessCheck = {
    name,
    run: async () => {
      calls += 1
      if (outcome === 'fail') throw new Error(`${name} 죽었다`)
      return 'PONG'
    },
  }
  return { check, calls: () => calls }
}

describe('ReadinessService', () => {
  it('확인이 전부 통과하면 준비된 것이다', async () => {
    const service = new ReadinessService([countingCheck('redis').check])

    const expected: ReadinessResult = { ready: true, failures: [] }
    await expect(service.check()).resolves.toEqual(expected)
  })

  it('하나만 실패해도 준비되지 않은 것이고, 실패한 이름을 남긴다', async () => {
    const service = new ReadinessService([
      countingCheck('redis').check,
      countingCheck('mysql', 'fail').check,
    ])

    const result = await service.check()

    expect(result.ready).toBe(false)
    expect(result.failures.map((failure) => failure.name)).toEqual(['mysql'])
    expect(reasonOf(result.failures[0])).toBe('mysql 죽었다')
  })

  it('확인이 동기로 던져도 실패로 잡는다', async () => {
    const service = new ReadinessService([
      {
        name: 'redis',
        run: () => {
          throw new Error('동기 실패')
        },
      },
    ])

    const result = await service.check()

    expect(result.ready).toBe(false)
    expect(result.failures.map((failure) => failure.name)).toEqual(['redis'])
  })

  /**
   * 확인이 매달리는 것은 가상의 상황이 아니다: ioredis는 오프라인 큐가 기본값이라
   * Redis가 죽어 있으면 `ping()`이 거부되지 않고 **큐에 쌓여 돌아오지 않는다.**
   * 상한이 없으면 컨테이너 `HEALTHCHECK`가 자기 타임아웃으로 잘려 판정이 사라진다.
   */
  it('돌아오지 않는 확인은 상한에서 끊어 DOWN으로 만든다', async () => {
    const service = new ReadinessService([{ name: 'redis', run: () => new Promise(() => {}) }], {
      timeoutMs: 20,
    })

    const result = await service.check()

    expect(result.ready).toBe(false)
    expect(reasonOf(result.failures[0])).toContain('20ms')
  })

  it('캐시 창 안의 반복 호출은 왕복을 다시 내지 않는다', async () => {
    let clock = 1_000
    const redis = countingCheck('redis')
    const service = new ReadinessService([redis.check], { now: () => clock })

    await service.check()
    await service.check()
    expect(redis.calls()).toBe(1)

    clock += READINESS_CACHE_MS
    await service.check()
    expect(redis.calls()).toBe(2)
  })

  /** 캐시만으로는 창이 만료된 순간 도착한 요청들이 나란히 왕복을 낸다. */
  it('동시 호출은 같은 왕복 하나로 합류한다', async () => {
    const redis = countingCheck('redis')
    const service = new ReadinessService([redis.check])

    const results = await Promise.all([service.check(), service.check(), service.check()])

    expect(redis.calls()).toBe(1)
    expect(results.every((result) => result.ready)).toBe(true)
  })

  it('판정이 바뀔 때만 알린다 — 죽어 있는 동안 같은 줄을 쌓지 않는다', async () => {
    let clock = 1_000
    let healthy = true
    const onChanged = vi.fn()
    const service = new ReadinessService(
      [
        {
          name: 'redis',
          run: () => {
            if (!healthy) throw new Error('죽었다')
            return 'PONG'
          },
        },
      ],
      { now: () => clock, onChanged },
    )

    // 첫 판정도 변화로 본다(부팅 시 "readiness UP" 한 줄이 남는다).
    await service.check()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged.mock.calls[0]?.[0]).toMatchObject({ ready: true })

    healthy = false
    clock += READINESS_CACHE_MS
    await service.check()
    clock += READINESS_CACHE_MS
    await service.check()
    expect(onChanged).toHaveBeenCalledTimes(2)
    expect(onChanged.mock.calls[1]?.[0]).toMatchObject({ ready: false })

    healthy = true
    clock += READINESS_CACHE_MS
    await service.check()
    expect(onChanged).toHaveBeenCalledTimes(3)
    expect(onChanged.mock.calls[2]?.[0]).toMatchObject({ ready: true })
  })

  it('확인이 없으면 준비된 것이다 — 판정할 의존이 없다는 뜻이다', async () => {
    const expected: ReadinessResult = { ready: true, failures: [] }
    await expect(new ReadinessService([]).check()).resolves.toEqual(expected)
  })
})

describe('확인 두 개', () => {
  it('redis 확인은 PING을 보낸다', async () => {
    const ping = vi.fn(async () => 'PONG')

    await redisReadinessCheck({ ping }).run()

    expect(ping).toHaveBeenCalledOnce()
  })

  it('mysql 확인은 SELECT 1을 보낸다', async () => {
    const query = vi.fn(async () => [[{ 1: 1 }], []])

    await mysqlReadinessCheck({ query }).run()

    expect(query).toHaveBeenCalledWith('SELECT 1')
  })
})
