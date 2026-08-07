import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPanel } from '@/room/components/StatusPanel'

describe('StatusPanel', () => {
  // 오류만 alert다 — 나머지를 alert로 두면 로딩마다 스크린리더를 끊는다.
  it('오류만 즉시 알리고 나머지는 조용한 status로 둔다', () => {
    const { rerender } = render(<StatusPanel variant="error" />)
    expect(screen.getByRole('alert')).toHaveTextContent('문제가 발생했어요')

    rerender(<StatusPanel variant="loading" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('variant마다 기본 제목과 설명을 갖춘다', () => {
    const { rerender } = render(<StatusPanel variant="loading" />)
    expect(screen.getByText('불러오는 중')).toBeVisible()
    expect(screen.getByText('잠시만 기다려 주세요.')).toBeVisible()

    rerender(<StatusPanel variant="empty" />)
    expect(screen.getByText('아직 내용이 없어요')).toBeVisible()
    expect(screen.getByText('새 항목이 생기면 여기에 표시됩니다.')).toBeVisible()

    rerender(<StatusPanel variant="reconnect" />)
    expect(screen.getByText('다시 연결하는 중')).toBeVisible()
    expect(screen.getByText('최신 게임 상태를 복구하고 있습니다.')).toBeVisible()

    rerender(<StatusPanel variant="error" />)
    expect(screen.getByText('문제가 발생했어요')).toBeVisible()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeVisible()
  })

  it('호출부가 준 문구가 기본 문구를 대체한다', () => {
    render(
      <StatusPanel
        className="mt-2"
        description="방 코드를 다시 확인해 주세요."
        title="방을 찾지 못했어요"
        variant="error"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('방을 찾지 못했어요')
    expect(screen.getByText('방 코드를 다시 확인해 주세요.')).toBeVisible()
    expect(screen.queryByText('문제가 발생했어요')).not.toBeInTheDocument()
  })

  it('로딩일 때만 진행 표시를 그리고, 그것은 소리로 읽히지 않는다', () => {
    const { container, rerender } = render(<StatusPanel variant="loading" />)
    const spinner = container.querySelector('[aria-hidden="true"]')
    expect(spinner).not.toBeNull()

    rerender(<StatusPanel variant="empty" />)
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
