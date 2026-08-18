import { QRCodeSVG } from 'qrcode.react'
import { Component, type ErrorInfo, type ReactNode, type RefObject, useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Popover, PopoverHeader } from '@/shared/components/Popover'

interface InvitePopoverProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  onClose: () => void
  open: boolean
  roomCode: string
}

export function InvitePopover({ anchorRef, onClose, open, roomCode }: InvitePopoverProps) {
  const inviteUrl = createInviteUrl(roomCode)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const close = () => {
    setCopyMessage(null)
    onClose()
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopyMessage('초대 링크를 복사했어요.')
    } catch {
      setCopyMessage('자동 복사에 실패했어요. 아래 링크를 길게 눌러 복사해 주세요.')
    }
  }

  const shareInvite = async () => {
    try {
      await navigator.share({
        title: 'YORR 파티 초대',
        text: `방 코드 ${roomCode}로 함께 플레이해요.`,
        url: inviteUrl,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setCopyMessage('공유를 열지 못했어요. 링크 복사를 이용해 주세요.')
    }
  }

  return (
    <Popover anchorRef={anchorRef} label="친구 초대하기" onClose={close} open={open}>
      <PopoverHeader onClose={close}>친구 초대</PopoverHeader>

      <div className="mt-3 grid gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <QrFallback>
            {/* 순백 고정 — QR 정숙 구역(quiet zone)은 스캐너가 코드를 찾는 기준이라
                테마를 따라가면 안 된다. 라이트 모드에서도 이 자리는 흰색이다. */}
            <QRCodeSVG
              className="size-28 flex-none rounded-card bg-white p-2"
              value={inviteUrl}
              level="M"
              marginSize={1}
              title={`방 ${roomCode} 초대 QR 코드`}
            />
          </QrFallback>
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="font-mono text-2xs font-bold tracking-[0.14em] text-content-muted uppercase">
              Room Code
            </span>
            <span className="block truncate font-mono text-xl leading-none font-bold tracking-[0.1em]">
              {roomCode}
            </span>
            <p className="m-0 truncate font-mono text-2xs text-content-muted">{inviteUrl}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            className="min-h-11 flex-1 px-3 text-sm"
            onClick={copyInvite}
            type="button"
            variant="secondary"
          >
            링크 복사
          </Button>
          {canShare && (
            <Button
              className="min-h-11 flex-1 px-3 text-sm"
              onClick={shareInvite}
              type="button"
              variant="ghost"
            >
              공유하기
            </Button>
          )}
        </div>
      </div>
      {copyMessage && (
        <p className="m-0 mt-3 text-sm text-content-muted" role="status" aria-live="polite">
          {copyMessage}
        </p>
      )}
    </Popover>
  )
}

export function createInviteUrl(roomCode: string, { party = false } = {}) {
  const origin = typeof window === 'undefined' ? 'https://yorr.invalid' : window.location.origin
  return `${origin}/join?code=${encodeURIComponent(roomCode)}${party ? '&party=1' : ''}`
}

export class QrFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.failed) {
      return (
        <p className="m-0 text-sm text-content-muted">
          QR을 만들지 못했어요. 링크나 방 코드를 사용해 주세요.
        </p>
      )
    }
    return this.props.children
  }
}
