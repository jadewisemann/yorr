import { describe, expect, it } from 'vitest'
import { MotionSampleNormalizer } from './normalizeMotionSample'

describe('MotionSampleNormalizer', () => {
  it('세로 화면의 x축을 좌우, -y축을 전방으로 정규화한다', () => {
    const normalizer = new MotionSampleNormalizer()
    const result = normalizer.push(event(100, 7, -4, 0), 0)

    expect(result).toMatchObject({
      forward: 4,
      horizontal: 7,
    })
  })

  it('화면 90도 회전에서도 화면 좌표로 축을 변환한다', () => {
    const normalizer = new MotionSampleNormalizer()
    const result = normalizer.push(event(100, 4, 7, 0), 90)

    expect(result).toMatchObject({
      forward: 4,
      horizontal: 7,
    })
  })

  it('중력 포함값만 있으면 첫 샘플을 중력 기준으로 삼는다', () => {
    const normalizer = new MotionSampleNormalizer()
    const first = normalizer.push(
      {
        acceleration: null,
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
        timeStamp: 100,
      },
      0,
    )

    expect(first).toMatchObject({ forward: 0, horizontal: 0, magnitude: 0 })
  })
})

function event(timeStamp: number, x: number, y: number, z: number) {
  return {
    acceleration: { x, y, z },
    accelerationIncludingGravity: null,
    timeStamp,
  }
}
