import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { DuelHowTo } from '@/duel/components/DuelHowTo'
import { SWING_THRESHOLD } from '@/duel/domain/duel'

const originalDeviceMotion = Object.getOwnPropertyDescriptor(window, 'DeviceMotionEvent')

function restoreDeviceMotion() {
  if (originalDeviceMotion) {
    Object.defineProperty(window, 'DeviceMotionEvent', originalDeviceMotion)
  } else {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
  }
}

function swing() {
  window.dispatchEvent(
    Object.assign(new Event('devicemotion'), {
      acceleration: { x: SWING_THRESHOLD * 2, y: 0, z: 0 },
    }),
  )
}

describe('@/duel/components/DuelHowTo', () => {
  afterEach(restoreDeviceMotion)

  it('권한이 이미 허용된 폰은 휘두르기만으로 연습이 끝난다', async () => {
    render(<DuelHowTo />)
    expect(await screen.findByText(/아래로 확 내려 보세요/)).toBeInTheDocument()

    swing()

    expect(await screen.findByRole('status')).toHaveTextContent('준비 완료')
  })

  it('센서를 못 쓰는 폰은 화면을 눌러 연습을 마친다', async () => {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
    render(<DuelHowTo />)

    await userEvent.click(await screen.findByRole('button', { name: '눌러서 연습 뽑기' }))

    expect(screen.getByRole('status')).toHaveTextContent('준비 완료')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('부정출발 규칙을 안내한다', () => {
    render(<DuelHowTo />)

    expect(screen.getByText(/부정출발 경고/)).toHaveTextContent('자기 발을 쏩니다')
  })
})
