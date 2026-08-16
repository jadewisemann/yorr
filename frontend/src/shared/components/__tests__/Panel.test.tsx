import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Panel } from '../Panel'

function root(node: React.ReactElement) {
  const { container } = render(node)
  return container.firstElementChild as HTMLElement
}

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('Panel', () => {
  it('기본은 div · surface 면', () => {
    const element = root(<Panel>내용</Panel>)
    expect(element.tagName).toBe('DIV')
    const classes = classSet(element)
    expect(classes).toContain('rounded-panel')
    expect(classes).toContain('border')
    expect(classes).toContain('border-border')
    expect(classes).toContain('bg-surface')
  })

  it('as로 시맨틱 태그를 고른다 — 상자를 div로 고정하지 않는다', () => {
    expect(root(<Panel as="section">내용</Panel>).tagName).toBe('SECTION')
    expect(root(<Panel as="article">내용</Panel>).tagName).toBe('ARTICLE')
    expect(root(<Panel as="ul">내용</Panel>).tagName).toBe('UL')
  })

  it('surface는 면만 바꾸고 라운드·테두리는 그대로 둔다', () => {
    for (const [surface, expected] of [
      ['raised', 'bg-surface-raised'],
      ['sunken', 'bg-surface-sunken'],
    ] as const) {
      const classes = classSet(root(<Panel surface={surface}>내용</Panel>))
      expect(classes).toContain(expected)
      expect(classes).not.toContain('bg-surface')
      expect(classes).toContain('rounded-panel')
      expect(classes).toContain('border-border')
    }
  })

  it('패딩은 기본값이 없다 — 호출부가 정한다', () => {
    expect(classSet(root(<Panel>내용</Panel>))).not.toContain('p-5')
    expect(classSet(root(<Panel className="p-5">내용</Panel>))).toContain('p-5')
  })

  it('className이 테두리를 이긴다 (GameResult·PlayerCard의 강조 테두리)', () => {
    const classes = classSet(
      root(
        <Panel className="border-border-strong" surface="raised">
          내용
        </Panel>,
      ),
    )
    expect(classes).toContain('border-border-strong')
    expect(classes).not.toContain('border-border')
  })

  it('aria 속성과 이벤트가 통과한다', () => {
    const element = root(
      <Panel as="section" aria-label="AI 봇 관리">
        내용
      </Panel>,
    )
    expect(element.getAttribute('aria-label')).toBe('AI 봇 관리')
  })
})
