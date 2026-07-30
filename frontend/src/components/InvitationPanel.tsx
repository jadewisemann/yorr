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
    // 디자인 03 초대 카드 — QR 좌측, ROOM CODE·링크·액션 우측의 가로 배치.
    <section
      className="grid gap-3 rounded-[1.25rem] border border-border bg-surface-raised p-4 shadow-raised"
      aria-labelledby="invite-title"
    >
      <h2 className="sr-only" id="invite-title">
        친구 초대하기
      </h2>
      {/* min-w-0: 이 행 자체가 section(grid)의 아이템이라 기본 min-width가 auto(내용 기준)다.
          안쪽 텍스트 열에만 min-w-0을 줘도 이 바깥 grid 아이템이 여전히 내용 기준 최소폭을
          고집해 방 코드가 긴 좁은 화면에서 행 전체가 넘쳤다(QA FND-4). */}
      <div className="flex min-w-0 items-stretch gap-4">
        <QrFallback>
          <QRCodeSVG
            className="size-[7.375rem] flex-none rounded-card bg-white p-2"
            value={inviteUrl}
            level="M"
            marginSize={1}
            title={`방 ${roomCode} 초대 QR 코드`}
          />
        </QrFallback>
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 text-left">
          <div className="grid min-w-0 gap-1">
            <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-content-muted uppercase">
              Room Code
            </span>
            {/* truncate: 최대 12자 방 코드는 clamp로도 아주 좁은 화면에선 살짝 넘칠 수 있다 —
                이 칸은 강조용 큰 표기일 뿐, 코드 전문은 위 헤더와 아래 링크에도 그대로 있다. */}
            <span className="block truncate font-mono text-[clamp(1.5rem,7vw,2.25rem)] leading-none font-bold tracking-[0.1em]">
              {roomCode}
            </span>
          </div>
          <p className="m-0 truncate font-mono text-[13px] text-content-muted">{inviteUrl}</p>
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
