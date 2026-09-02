import { describe, expect, it } from 'vitest'
import {
  ballY,
  FAR_Z,
  NEAR_Z,
  posToZ,
  TABLE_H,
  TABLE_LEN,
  viewerDepth,
  xToWorld,
} from '@/pingpong/domain/court'

describe('ping pong court depth', () => {
  it('uses the extended table depth for both geometry endpoints and ball travel', () => {
    expect(TABLE_LEN).toBeCloseTo(3.5072)
    expect(posToZ(0)).toBe(FAR_Z)
    expect(posToZ(1)).toBe(NEAR_Z)
    expect(NEAR_Z - FAR_Z).toBeCloseTo(TABLE_LEN)
  })
})

/**
 * 공 높이는 **바운스 전후로 다른 곡선**이다. 앞은 포물선, 뒤는 튀어 오른 뒤 상대
 * 코트로 떨어지는 곡선이며, 스매시는 더 낮고 빠르게 간다.
 */
describe('ballY', () => {
  it('바운스 전후가 이어지고 시작·끝은 테이블 높이 근처다', () => {
    expect(ballY(0, false)).toBeGreaterThanOrEqual(TABLE_H)
    expect(ballY(1, false)).toBeGreaterThanOrEqual(TABLE_H)
    // 중간이 가장 높다 — 그러지 않으면 공이 테이블을 뚫고 간다.
    expect(ballY(0.35, false)).toBeGreaterThan(ballY(0, false))
    expect(ballY(0.35, false)).toBeGreaterThan(ballY(1, false))
  })

  it('스매시는 같은 지점에서 더 낮게 지나간다', () => {
    expect(ballY(0.35, true)).toBeLessThan(ballY(0.35, false))
  })

  it('진행도는 0~1로 잘린다 — 범위 밖 입력도 곡선 위에 남는다', () => {
    expect(ballY(-1, false)).toBe(ballY(0, false))
    expect(ballY(2, false)).toBe(ballY(1, false))
  })

  it('아웃과 네트는 서로 다른 낙하 곡선을 탄다', () => {
    expect(ballY(0.5, false, 'out', 0.2)).not.toBe(ballY(0.5, false, 'net', 0.2))
  })

  /** 정규 좌표(0~1)와 3D 월드 좌표를 잇는 두 변환. 렌더러가 이 값으로 라켓과 공을 놓는다. */
  it('좌우 정규 좌표는 테이블 폭 위의 월드 좌표가 된다', () => {
    expect(xToWorld(0.5)).toBe(0)
    expect(xToWorld(1)).toBeGreaterThan(0)
    expect(xToWorld(0)).toBe(-xToWorld(1))
  })

  it('보는 사람이 2번이면 앞뒤가 뒤집힌다', () => {
    expect(viewerDepth(0.25, 1)).toBe(0.25)
    expect(viewerDepth(0.25, 2)).toBe(0.75)
  })
})
