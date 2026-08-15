import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from '../Alert'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('Alert', () => {
  it('기본은 neutral — live region이 아니다', () => {
    const { container } = render(<Alert>방을 만든 사람이 호스트가 돼요</Alert>)

    const alert = container.firstElementChild as HTMLElement
    expect(alert.getAttribute('role')).toBeNull()
    const classes = classSet(alert)
    expect(classes).toContain('border-border')
    expect(classes).toContain('bg-surface')
    expect(classes).toContain('text-content-muted')
  })

  it('danger는 role=alert로 읽히고, positive는 role=status로 읽힌다', () => {
    render(<Alert tone="danger">로그인이 필요해요</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('로그인이 필요해요')

    render(<Alert tone="positive">점수가 반영됐습니다</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('점수가 반영됐습니다')
  })

  it('톤이 정한 role을 호출부가 덮을 수 있다', () => {
    render(
      <Alert role="status" tone="danger">
        연결이 끊겼습니다
      </Alert>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('연결이 끊겼습니다')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('공통 형태(라운드·테두리·패딩·글자 크기)는 톤과 무관하게 같다', () => {
    const { container } = render(<Alert tone="danger">오류</Alert>)

    const classes = classSet(container.firstElementChild as HTMLElement)
    expect(classes).toContain('rounded-card')
    expect(classes).toContain('border')
    expect(classes).toContain('px-3.5')
    expect(classes).toContain('py-3')
    expect(classes).toContain('text-sm')
  })

  it('className이 톤 색을 이긴다 — 외부 배치·덮어쓰기는 호출부 몫', () => {
    const { container } = render(
      <Alert className="grid gap-2 bg-surface-raised text-left" tone="danger">
        오류
      </Alert>,
    )

    const classes = classSet(container.firstElementChild as HTMLElement)
    expect(classes).toContain('bg-surface-raised')
    expect(classes).not.toContain('bg-brand/8')
    expect(classes).toContain('grid')
    expect(classes).toContain('text-left')
  })
})
