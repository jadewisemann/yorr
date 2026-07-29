import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('전달된 클릭 핸들러를 그대로 호출한다', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick}>방 만들기</Button>)

    await user.click(screen.getByRole('button', { name: '방 만들기' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  // 스피너는 aria-hidden이라, 진행 중임을 알리는 유일한 신호가 aria-busy다.
  it('loading 동안 진행 상태를 알리고 중복 제출을 막는다', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Button loading onClick={onClick}>
        만드는 중
      </Button>,
    )

    const button = screen.getByRole('button', { name: '만드는 중' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('평소에는 aria-busy를 남기지 않는다', () => {
    render(<Button>방 만들기</Button>)

    expect(screen.getByRole('button', { name: '방 만들기' })).not.toHaveAttribute('aria-busy')
  })

  it('disabled면 loading이 아니어도 눌리지 않는다', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Button disabled onClick={onClick} size="lg" variant="danger">
        나가기
      </Button>,
    )

    const button = screen.getByRole('button', { name: '나가기' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('type 같은 native 속성을 통과시킨다', () => {
    render(
      <Button size="sm" type="submit" variant="ghost">
        확인
      </Button>,
    )

    expect(screen.getByRole('button', { name: '확인' })).toHaveAttribute('type', 'submit')
  })

  it('전달한 className이 기본 스타일을 덮을 수 있게 함께 남는다', () => {
    render(
      <Button className="w-full" variant="secondary">
        복사
      </Button>,
    )

    expect(screen.getByRole('button', { name: '복사' })).toHaveClass('w-full')
  })
})
