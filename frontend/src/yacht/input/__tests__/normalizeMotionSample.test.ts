import { afterEach, describe, expect, it } from 'vitest'
import { MotionSampleNormalizer } from '@/yacht/input/normalizeMotionSample'

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

  it('첫 샘플 이후에는 저역 통과로 중력을 계속 빼낸다', () => {
    const normalizer = new MotionSampleNormalizer()
    normalizer.push(gravityEvent(100, 0, 0, 9.8), 0)

    const moved = normalizer.push(gravityEvent(120, 5, -3, 9.8), 0)

    // 중력 성분(z)은 상쇄되고 갑작스러운 좌우·전방 성분만 남는다.
    expect(moved?.horizontal).toBeGreaterThan(4)
    expect(moved?.forward).toBeGreaterThan(2)
  })

  it('화면 180도·270도 회전에서도 화면 좌표로 축을 변환한다', () => {
    expect(new MotionSampleNormalizer().push(event(100, 7, -4, 0), 180)).toMatchObject({
      forward: -4,
      horizontal: -7,
    })
    expect(new MotionSampleNormalizer().push(event(100, 7, -4, 0), 270)).toMatchObject({
      forward: -7,
      horizontal: 4,
    })
  })

  it('데드존보다 작은 흔들림은 0으로 눌러 노이즈를 걸러낸다', () => {
    const result = new MotionSampleNormalizer().push(event(100, 0.2, -0.3, 0.1), 0)

    expect(result).toMatchObject({ forward: 0, horizontal: 0, magnitude: 0 })
  })

  it('시각이 진행하지 않은 샘플은 버린다 — dt가 0이면 미분값이 의미 없다', () => {
    const normalizer = new MotionSampleNormalizer()
    normalizer.push(event(100, 7, -4, 0), 0)

    expect(normalizer.push(event(100, 7, -4, 0), 0)).toBeNull()
    expect(normalizer.push(event(Number.NaN, 7, -4, 0), 0)).toBeNull()
  })

  it('축 하나라도 값이 없거나 유한하지 않으면 샘플을 버린다', () => {
    const normalizer = new MotionSampleNormalizer()

    expect(
      normalizer.push(
        {
          acceleration: { x: 1, y: null, z: 1 },
          accelerationIncludingGravity: null,
          timeStamp: 10,
        },
        0,
      ),
    ).toBeNull()
    expect(
      normalizer.push(
        {
          acceleration: { x: Number.POSITIVE_INFINITY, y: 1, z: 1 },
          accelerationIncludingGravity: null,
          timeStamp: 30,
        },
        0,
      ),
    ).toBeNull()
  })

  it('reset 뒤에는 중력 기준과 직전 시각을 다시 학습한다', () => {
    const normalizer = new MotionSampleNormalizer()
    normalizer.push(gravityEvent(100, 0, 0, 9.8), 0)
    normalizer.reset()

    // 리셋했으므로 같은 시각을 다시 써도 dt가 기본값으로 잡혀 통과한다.
    expect(normalizer.push(gravityEvent(100, 0, 0, 9.8), 0)).toMatchObject({ magnitude: 0 })
  })
})

describe('화면 방향 자동 감지', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.screen, 'orientation')
    Reflect.deleteProperty(window, 'orientation')
  })

  it('screen.orientation.angle을 기본 회전각으로 쓴다', () => {
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { angle: 90 },
    })

    // 90도 회전에서는 y축이 좌우가 된다.
    expect(new MotionSampleNormalizer().push(event(100, 4, 7, 0))).toMatchObject({
      horizontal: 7,
      forward: 4,
    })
  })

  it('screen.orientation이 없으면 레거시 window.orientation으로 떨어진다', () => {
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: undefined })
    Object.defineProperty(window, 'orientation', { configurable: true, value: 180 })

    expect(new MotionSampleNormalizer().push(event(100, 7, -4, 0))).toMatchObject({
      horizontal: -7,
      forward: -4,
    })
  })

  it('회전각을 알 수 없으면 세로(0도)로 본다', () => {
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: undefined })

    expect(new MotionSampleNormalizer().push(event(100, 7, -4, 0))).toMatchObject({
      horizontal: 7,
      forward: 4,
    })
  })
})

function gravityEvent(timeStamp: number, x: number, y: number, z: number) {
  return {
    acceleration: null,
    accelerationIncludingGravity: { x, y, z },
    timeStamp,
  }
}

function event(timeStamp: number, x: number, y: number, z: number) {
  return {
    acceleration: { x, y, z },
    accelerationIncludingGravity: null,
    timeStamp,
  }
}
