import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TextField } from '@/shared/components/TextField'

describe('TextField', () => {
  it('connects its label and help text to the input', () => {
    render(<TextField label="닉네임" helpText="비워두면 추천 이름을 사용해요." />)

    const input = screen.getByRole('textbox', { name: '닉네임' })
    const help = screen.getByText('비워두면 추천 이름을 사용해요.')

    expect(input).toHaveAccessibleDescription('비워두면 추천 이름을 사용해요.')
    expect(input).toHaveAttribute('aria-describedby', help.id)
  })

  it('announces an error and marks the input as invalid', () => {
    render(<TextField label="닉네임" errorMessage="특수문자는 사용할 수 없어요." />)

    const input = screen.getByRole('textbox', { name: '닉네임' })

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('특수문자는 사용할 수 없어요.')
    expect(input).toHaveAccessibleDescription('특수문자는 사용할 수 없어요.')
  })
})
