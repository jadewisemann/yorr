import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PingPongControllerHowTo } from '@/pingpong/components/PingPongControllerHowTo'

/** 센서가 값을 주는 순간. useSwing은 중력을 저역통과로 빼므로 임계값(14)보다 넉넉히 준다. */
function swingPhone() {
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event('devicemotion'), { acceleration: { x: 24, y: 0, z: 0 } }),
    )
  })
}

/** 권한 API가 없는 기기(안드로이드 계열) — 마운트 즉시 센서가 붙는다. */
function stubMotionSensor() {
  vi.stubGlobal('DeviceMotionEvent', function DeviceMotionEventStub() {})
}

describe('@/pingpong/components/PingPongControllerHowTo', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('잡는 법 → 스윙 감지 → 완료 순으로 넘어간다', async () => {
    stubMotionSensor()
    const user = userEvent.setup()
    render(<PingPongControllerHowTo />)

    expect(screen.getByText('폰을 라켓처럼 쥐세요')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '스윙 연습하기' }))
    expect(screen.getByText('한 번 휘둘러 보세요')).toBeVisible()

    swingPhone()
    expect(screen.getByText('스윙 감지 완료')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('준비 완료를 누르면 경기가 시작돼요')
  })

  // 잡는 법을 읽으며 폰을 고쳐 쥐는 것도 임계값을 넘긴다 — 그것으로 단계가 넘어가면
  // 정작 휘둘러 볼 기회 없이 "감지 완료"만 읽고 끝난다.
  it('스윙 단계에 들어가기 전의 흔들림은 세지 않는다', () => {
    stubMotionSensor()
    render(<PingPongControllerHowTo />)

    swingPhone()
    expect(screen.getByText('폰을 라켓처럼 쥐세요')).toBeVisible()
  })

  it('모션 센서를 쓸 수 없으면 탭 조작으로 안내하고 그 탭으로 완료한다', async () => {
    // jsdom에는 DeviceMotionEvent가 있다 — 센서 없는 기기는 명시적으로 만들어야 한다.
    vi.stubGlobal('DeviceMotionEvent', undefined)
    const user = userEvent.setup()
    render(<PingPongControllerHowTo />)

    await user.click(screen.getByRole('button', { name: '스윙 연습하기' }))
    expect(screen.getByText(/모션 센서를 쓸 수 없어요/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '화면을 눌러 스윙' }))
    expect(screen.getByText('탭 조작으로 준비됐어요')).toBeVisible()
  })

  // iOS는 탭 안에서만 권한을 받는다 — 이 버튼이 그 탭이다.
  it('권한을 거부하면 같은 자리에서 탭 폴백으로 바뀐다', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal(
      'DeviceMotionEvent',
      Object.assign(function DeviceMotionEventStub() {}, { requestPermission }),
    )
    const user = userEvent.setup()
    render(<PingPongControllerHowTo />)

    await user.click(screen.getByRole('button', { name: '스윙 연습하기' }))

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(screen.getByText(/모션 센서를 쓸 수 없어요/)).toBeVisible()
  })
})
