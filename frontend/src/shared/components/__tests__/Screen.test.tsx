import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ControllerScreen, PlayBoard, Screen } from '../Screen'

/** 렌더된 class를 집합으로 본다 — 순서는 CSS에 영향이 없다. */
function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('Screen', () => {
  it('flow 프레임이 문서 흐름 화면의 껍데기를 그대로 만든다', () => {
    render(<Screen className="max-w-lg">본문</Screen>)

    expect(classSet(screen.getByRole('main'))).toEqual(
      new Set([
        'mx-auto',
        'w-full',
        'text-content',
        'flex',
        'min-h-dvh',
        'flex-col',
        'px-gutter',
        'pt-safe-top',
        'pb-safe-bottom',
        'max-w-lg',
      ]),
    )
  })

  /**
   * 이 단정이 이 파일의 존재 이유다. InAppBrowserGate·PartyOnBigScreenPage는 프레임 기본값보다
   * 큰 상단 여백을 쓴다. cn.ts의 spacing 목록에 safe-top이 등록돼 있지 않으면 tailwind-merge가
   * 두 class를 같은 충돌 그룹으로 보지 못해 **둘 다 살아남고** 승자를 빌드된 CSS 선언 순서가
   * 정한다 — 화면은 조용히 기본값으로 그려지고 테스트는 통과한다.
   */
  it('호출부의 pt override가 프레임 기본값을 이긴다', () => {
    render(<Screen className="pt-[max(2.5rem,env(safe-area-inset-top))]">본문</Screen>)

    const classes = classSet(screen.getByRole('main'))
    expect(classes).toContain('pt-[max(2.5rem,env(safe-area-inset-top))]')
    expect(classes).not.toContain('pt-safe-top')
  })

  it('viewport 프레임은 높이를 뷰포트에 고정하고 문서를 늘리지 않는다', () => {
    render(
      <Screen className="max-w-2xl" frame="viewport">
        본문
      </Screen>,
    )

    const classes = classSet(screen.getByRole('main'))
    expect(classes).toContain('h-svh')
    expect(classes).toContain('overflow-hidden')
    expect(classes).not.toContain('min-h-dvh')
  })
})

describe('PlayBoard', () => {
  it('넓은 폭에서는 2열 grid, 좁은 폭에서는 세로 flex다', () => {
    const { rerender } = render(<PlayBoard wide={true}>본문</PlayBoard>)

    let classes = classSet(screen.getByRole('main'))
    expect(classes).toContain('grid')
    expect(classes).toContain('grid-cols-[minmax(0,1fr)_28rem]')
    expect(classes).not.toContain('flex-col')

    rerender(<PlayBoard wide={false}>본문</PlayBoard>)

    classes = classSet(screen.getByRole('main'))
    expect(classes).toContain('flex')
    expect(classes).toContain('flex-col')
    expect(classes).not.toContain('grid')
  })

  it('게임판 3화면이 쓰던 껍데기와 class 집합이 같다', () => {
    render(<PlayBoard wide={false}>본문</PlayBoard>)

    expect(classSet(screen.getByRole('main'))).toEqual(
      new Set(
        'mx-auto h-svh w-full max-w-play overflow-hidden bg-canvas text-content flex flex-col'.split(
          ' ',
        ),
      ),
    )
  })
})

describe('ControllerScreen', () => {
  it('컨트롤러 2화면이 쓰던 껍데기와 class 집합이 같다(배경만 호출부가 준다)', () => {
    render(<ControllerScreen className="bg-duel-canvas">본문</ControllerScreen>)

    expect(classSet(screen.getByRole('main'))).toEqual(
      new Set(
        'relative flex h-svh w-full touch-none flex-col overflow-hidden bg-duel-canvas px-5 pt-safe-top pb-safe-bottom text-white select-none mx-auto'.split(
          ' ',
        ),
      ),
    )
  })
})
