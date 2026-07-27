import { QRCodeSVG } from 'qrcode.react'
import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { Button } from './Button'

interface InvitationPanelProps {
  roomCode: string
}

export function InvitationPanel({ roomCode }: InvitationPanelProps) {
  const inviteUrl = createInviteUrl(roomCode)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

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
    <section
      className="grid gap-4 rounded-panel border border-border bg-surface p-5 text-center shadow-raised"
      aria-labelledby="invite-title"
    >
      <div className="grid gap-1">
        <h2 id="invite-title" className="m-0 text-lg font-bold">
          친구 초대하기
        </h2>
        <p className="m-0 text-sm text-content-muted">QR을 스캔하면 코드 입력 없이 참가해요.</p>
      </div>
      <QrFallback>
        <QRCodeSVG
          className="mx-auto h-auto w-full max-w-52 rounded-control bg-white p-3"
          value={inviteUrl}
          level="M"
          marginSize={1}
          title={`방 ${roomCode} 초대 QR 코드`}
        />
      </QrFallback>
      <p className="m-0 text-2xl font-bold tracking-[0.2em] text-brand-strong">{roomCode}</p>
      <p className="m-0 break-all text-xs text-content-muted">{inviteUrl}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" variant="secondary" onClick={copyInvite}>
          링크 복사
        </Button>
        {canShare && (
          <Button type="button" variant="secondary" onClick={shareInvite}>
            공유
          </Button>
        )}
      </div>
      {copyMessage && (
        <p className="m-0 text-sm text-content-muted" role="status" aria-live="polite">
          {copyMessage}
        </p>
      )}
    </section>
  )
}

export function createInviteUrl(roomCode: string) {
  const origin = typeof window === 'undefined' ? 'https://yorr.invalid' : window.location.origin
  return `${origin}/join?code=${encodeURIComponent(roomCode)}`
}

class QrFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The room code and canonical link remain available as the fallback.
  }

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
