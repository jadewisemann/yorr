import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('탭하면 열리고 다시 탭하면 닫힌다', async () => {
    const user = userEvent.setup()
    render(<Tooltip content="턴마다 최대 3번" label="남은 굴리기 설명" />)

    const trigger = screen.getByRole('button', { name: '남은 굴리기 설명' })
    await user.click(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('턴마다 최대 3번')
    expect(trigger).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)

    await user.click(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('Escape로 닫힌다', async () => {
    const user = userEvent.setup()
    render(<Tooltip content="설명" label="설명 열기" />)

    await user.click(screen.getByRole('button', { name: '설명 열기' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('바깥을 탭하면 닫힌다', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Tooltip content="설명" label="설명 열기" />
        <p>바깥 영역</p>
      </>,
    )

    await user.click(screen.getByRole('button', { name: '설명 열기' }))
    await user.click(screen.getByText('바깥 영역'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
