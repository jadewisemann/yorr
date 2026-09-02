import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInviteUrl, InvitePopover } from '@/room/components/InvitePopover'

const { qrState } = vi.hoisted(() => ({ qrState: { fail: false } }))

vi.mock('qrcode.react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('qrcode.react')>()
  return {
    ...actual,
    QRCodeSVG: (props: Record<string, unknown>) => {
      if (qrState.fail) throw new Error('QR 생성 실패')
      return createElement(actual.QRCodeSVG, props as never)
    },
  }
})

const originalClipboard = navigator.clipboard

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

function stubShare(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
}

beforeEach(() => {
  qrState.fail = false
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  Reflect.deleteProperty(navigator, 'share')
})

/** 공유가 실패하는 상황. 실패 사유마다 화면이 무엇을 남기는지 갈린다. */
async function shareFailing(reason: unknown) {
  stubShare(vi.fn().mockRejectedValue(reason))
  const user = userEvent.setup()
  render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

  await user.click(screen.getByRole('button', { name: '공유하기' }))
}

describe('createInviteUrl', () => {
  it('방 코드를 쿼리에 안전하게 실어 준다', () => {
    expect(createInviteUrl('AB12CD')).toBe(`${window.location.origin}/join?code=AB12CD`)
    expect(createInviteUrl('A B&C')).toBe(`${window.location.origin}/join?code=A%20B%26C`)
  })
})

describe('InvitePopover', () => {
  it('방 코드와 초대 링크를 함께 보여 준다', () => {
    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    expect(screen.getByText('AB12CD')).toBeVisible()
    expect(screen.getByText(createInviteUrl('AB12CD'))).toBeVisible()
    expect(screen.getByRole('img', { name: '방 AB12CD 초대 QR 코드' })).toBeInTheDocument()
  })

  it('복사에 성공하면 결과를 알림 영역으로 알린다', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '링크 복사' }))

    expect(writeText).toHaveBeenCalledWith(createInviteUrl('AB12CD'))
    expect(await screen.findByRole('status')).toHaveTextContent('초대 링크를 복사했어요.')
  })

  it('닫으면 지난 복사 결과 문구를 지운다', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    const onClose = vi.fn()
    const { rerender } = render(<InvitePopover onClose={onClose} open roomCode="AB12CD" />)

    await user.click(screen.getByRole('button', { name: '링크 복사' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<InvitePopover onClose={onClose} open={false} roomCode="AB12CD" />)
    rerender(<InvitePopover onClose={onClose} open roomCode="AB12CD" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('복사가 막히면 직접 복사하도록 안내한다', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    await user.click(screen.getByRole('button', { name: '링크 복사' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '자동 복사에 실패했어요. 아래 링크를 길게 눌러 복사해 주세요.',
    )
  })

  it('공유를 지원하지 않는 브라우저에서는 공유 버튼을 감춘다', () => {
    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    expect(screen.queryByRole('button', { name: '공유하기' })).not.toBeInTheDocument()
  })

  it('공유를 지원하면 방 코드를 담아 공유 시트를 연다', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubShare(share)
    const user = userEvent.setup()
    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    await user.click(screen.getByRole('button', { name: '공유하기' }))

    expect(share).toHaveBeenCalledWith({
      title: 'YORR 파티 초대',
      text: '방 코드 AB12CD로 함께 플레이해요.',
      url: createInviteUrl('AB12CD'),
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('사용자가 공유를 취소하면 아무 문구도 남기지 않는다', async () => {
    await shareFailing(new DOMException('cancelled', 'AbortError'))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('공유를 열지 못하면 링크 복사로 우회하도록 알린다', async () => {
    await shareFailing(new Error('not allowed'))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '공유를 열지 못했어요. 링크 복사를 이용해 주세요.',
    )
  })

  it('QR 생성이 실패해도 방 코드와 링크는 남는다', () => {
    qrState.fail = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<InvitePopover onClose={() => undefined} open roomCode="AB12CD" />)

    expect(screen.getByText('QR을 만들지 못했어요. 링크나 방 코드를 사용해 주세요.')).toBeVisible()
    expect(screen.getByText('AB12CD')).toBeVisible()
    expect(screen.getByRole('button', { name: '링크 복사' })).toBeEnabled()

    consoleError.mockRestore()
  })
})
