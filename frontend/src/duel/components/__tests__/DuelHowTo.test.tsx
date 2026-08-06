import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { DuelHowTo } from '@/duel/components/DuelHowTo'
import { SWING_THRESHOLD } from '@/duel/domain/duel'

/**
 * 대기실 사용법 슬롯. (S15P11A406-207)
 *
 * 검사하는 것은 <b>연습을 끝낼 수 있는가</b>다. 여기서 막히면 폰은 준비되지 못한 채 게임에
 * 들어가고, 신호가 초록이 되는 첫 순간에 감지 세기를 처음 시험하게 된다.
 *
 * 센서 유무로 경로가 갈리므로 둘 다 본다. jsdom은 `DeviceMotionEvent`가 권한 API 없이
 * 있으므로 기본값이 안드로이드와 같은 "즉시 허용"이다.
 */

const originalDeviceMotion = Object.getOwnPropertyDescriptor(window, 'DeviceMotionEvent')

function restoreDeviceMotion() {
  if (originalDeviceMotion) {
    Object.defineProperty(window, 'DeviceMotionEvent', originalDeviceMotion)
  } else {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
  }
}

/** 임계값을 넘는 한 번의 휘두름. */
function swing() {
  window.dispatchEvent(
    Object.assign(new Event('devicemotion'), {
      acceleration: { x: SWING_THRESHOLD * 2, y: 0, z: 0 },
    }),
  )
}

describe('@/duel/components/DuelHowTo', () => {
  afterEach(restoreDeviceMotion)

  /**
   * 권한 API가 없는 폰(안드로이드)은 마운트 즉시 허용이라 "휘두르기 켜기" 버튼이 뜨지 않는다.
   * 예전에는 그 버튼만이 센서 게이트를 열 수 있어서, 이 폰에서는 아무리 휘둘러도 연습이
   * 끝나지 않았다.
   */
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

  /** 부정출발 규칙은 단계와 무관하게 계속 보인다 — 경고 두 개가 차면 자기 발을 쏜다. */
  it('부정출발 규칙을 안내한다', () => {
    render(<DuelHowTo />)

    expect(screen.getByText(/부정출발 경고/)).toHaveTextContent('자기 발을 쏩니다')
  })
})
