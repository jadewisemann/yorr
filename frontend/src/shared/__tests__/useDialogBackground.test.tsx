import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDialogBackground } from '@/shared/useDialogBackground'

function Dialog({ open }: { open: boolean }) {
  useDialogBackground(open)
  return null
}

function renderWithBackground(ui: React.ReactNode) {
  const main = document.createElement('main')
  document.body.append(main)
  const view = render(ui)
  return { ...view, main }
}

afterEach(() => {
  document.body.style.overflow = ''
  for (const main of document.querySelectorAll('main')) main.remove()
})

describe('useDialogBackground', () => {
  it('열려 있는 동안 뒤 화면의 스크롤을 잠그고 inert로 무력화한다', () => {
    document.body.style.overflow = 'auto'
    const { main, unmount } = renderWithBackground(<Dialog open />)

    expect(document.body.style.overflow).toBe('hidden')
    expect(main).toHaveAttribute('inert')

    unmount()

    expect(document.body.style.overflow).toBe('auto')
    expect(main).not.toHaveAttribute('inert')
  })

  it('닫혀 있으면 뒤 화면을 건드리지 않는다', () => {
    const { main } = renderWithBackground(<Dialog open={false} />)

    expect(document.body.style.overflow).toBe('')
    expect(main).not.toHaveAttribute('inert')
  })

  it('겹쳐 열린 다이얼로그 중 마지막이 닫힐 때만 배경을 되살린다', () => {
    const { main, rerender } = renderWithBackground(
      <>
        <Dialog open />
        <Dialog open />
      </>,
    )
    expect(main).toHaveAttribute('inert')

    rerender(
      <>
        <Dialog open />
        <Dialog open={false} />
      </>,
    )

    expect(document.body.style.overflow).toBe('hidden')
    expect(main).toHaveAttribute('inert')

    rerender(
      <>
        <Dialog open={false} />
        <Dialog open={false} />
      </>,
    )

    expect(document.body.style.overflow).toBe('')
    expect(main).not.toHaveAttribute('inert')
  })

  it('main이 없는 화면에서도 스크롤 잠금만 적용한다', () => {
    const view = render(<Dialog open />)

    expect(document.body.style.overflow).toBe('hidden')
    expect(() => view.unmount()).not.toThrow()
  })
})
