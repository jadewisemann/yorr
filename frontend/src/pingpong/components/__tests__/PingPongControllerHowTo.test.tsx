import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PingPongControllerHowTo } from '@/pingpong/components/PingPongControllerHowTo'

function swingPhone() {
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event('devicemotion'), { acceleration: { x: 24, y: 0, z: 0 } }),
    )
  })
}

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

  it('스윙 단계에 들어가기 전의 흔들림은 세지 않는다', () => {
    stubMotionSensor()
    render(<PingPongControllerHowTo />)

    swingPhone()
    expect(screen.getByText('폰을 라켓처럼 쥐세요')).toBeVisible()
  })

  it('모션 센서를 쓸 수 없으면 탭 조작으로 안내하고 그 탭으로 완료한다', async () => {
    vi.stubGlobal('DeviceMotionEvent', undefined)
    const user = userEvent.setup()
    render(<PingPongControllerHowTo />)

    await user.click(screen.getByRole('button', { name: '스윙 연습하기' }))
    expect(screen.getByText(/모션 센서를 쓸 수 없어요/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '화면을 눌러 스윙' }))
    expect(screen.getByText('탭 조작으로 준비됐어요')).toBeVisible()
  })

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
