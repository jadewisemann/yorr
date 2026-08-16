import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '../Badge'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

function renderBadge(node: React.ReactElement) {
  const { container } = render(node)
  return classSet(container.firstElementChild as HTMLElement)
}

describe('Badge', () => {
  it('기본은 neutral', () => {
    const classes = renderBadge(<Badge>2인</Badge>)
    expect(classes).toContain('border-border')
    expect(classes).toContain('text-content-muted')
  })

  it('톤은 색 세 줄만 바꾸고 형태는 건드리지 않는다', () => {
    const warning = renderBadge(<Badge tone="warning">연결 끊김</Badge>)
    expect(warning).toContain('border-warning/40')
    expect(warning).toContain('bg-warning/12')
    expect(warning).toContain('text-warning')

    const brand = renderBadge(<Badge tone="brand">추천</Badge>)
    expect(brand).toContain('border-brand/40')
    expect(brand).toContain('text-brand')

    for (const classes of [warning, brand]) {
      expect(classes).toContain('rounded-full')
      expect(classes).toContain('px-2')
      expect(classes).toContain('py-0.5')
      expect(classes).toContain('text-2xs')
    }
  })

  it('크기는 호출부 몫 — className이 기본 패딩·글자를 이긴다', () => {
    const classes = renderBadge(
      <Badge className="px-1.5 text-2xs/none" tone="warning">
        연결 끊김
      </Badge>,
    )
    expect(classes).toContain('px-1.5')
    expect(classes).not.toContain('px-2')
    expect(classes).toContain('text-2xs/none')
    expect(classes).not.toContain('text-2xs')
  })

  it('톤 색도 호출부가 덮을 수 있다 (ProviderChoice의 흐린 글자)', () => {
    const classes = renderBadge(<Badge className="text-content-faint">준비 중</Badge>)
    expect(classes).toContain('text-content-faint')
    expect(classes).not.toContain('text-content-muted')
  })
})
