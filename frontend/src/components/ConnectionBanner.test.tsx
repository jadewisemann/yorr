import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConnectionBanner } from './ConnectionBanner'

describe('ConnectionBanner', () => {
  // 영역과 문구가 같은 프레임에 들어오면 스크린리더가 변화를 놓친다 —
  // 정상 연결에도 빈 live region을 남겨 두고 글만 바꿔야 한다.
  it('정상 연결에서는 문구 없이 빈 알림 영역만 남긴다', () => {
    const { rerender } = render(<ConnectionBanner status="connected" />)

    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveAttribute('aria-live', 'polite')

    rerender(<ConnectionBanner status="idle" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('연결 중에는 기다려 달라고만 알린다', () => {
    render(<ConnectionBanner status="connecting" />)

    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('연결하는 중…')
    expect(region).toHaveTextContent('잠시만 기다려 주세요.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('재연결 중에는 진행 상황과 함께 점수가 보존됨을 안내한다', () => {
    render(<ConnectionBanner status="reconnecting" />)

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('다시 연결하는 중…')
    expect(region).toHaveTextContent('현재 주사위와 점수는 서버에 저장돼 있습니다.')
  })

  // 연결이 끊기면 조작이 통째로 잠기므로 polite로 미룰 수 없다.
  it('연결이 끊기면 alert로 즉시 알린다', () => {
    render(<ConnectionBanner className="rounded-none" status="closed" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(alert).toHaveTextContent('연결이 끊겼습니다')
    expect(alert).toHaveTextContent('네트워크를 확인한 뒤 다시 시도해 주세요.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // 색상만으로 상태를 구분하지 않되, 그 표식이 문구를 두 번 읽게 하면 안 된다.
  it('상태 표식은 소리로 읽히지 않는다', () => {
    render(<ConnectionBanner status="reconnecting" />)

    const marker = screen.getByRole('status').querySelector('[aria-hidden="true"]')
    expect(marker).not.toBeNull()
  })
})
