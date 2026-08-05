import { QRCodeSVG } from 'qrcode.react'
import { Component, type ErrorInfo, type ReactNode, type RefObject, useState } from 'react'
import { Button } from '@/shared/components/Button'
import { Popover } from '@/shared/components/Popover'

interface InvitePopoverProps {
  /** 팝오버를 여는 초대 버튼. 그 아래에 꼬리를 물고 붙는다. */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  onClose: () => void
  open: boolean
  roomCode: string
}

/**
 * QR·방 코드·링크 복사·공유를 담은 초대 말풍선.
 * <p>
 * 대기실 인라인 카드였다가 말풍선이 됐다. 320×568에서는 이 카드 하나가 세로를 다 먹어 참가자
 * 목록이 4px로 짜부라졌다(S15P11A406-203) — 초대는 방을 만든 직후 한 번 하는 조작이라 항시
 * 노출할 값이 없다. 큰 화면 QR 상시 노출은 파티 대시보드가 맡는다.
 * <p>
 * 세로로 쌓는다. 인라인 카드는 QR 좌·텍스트 우 배치였는데, 팝오버 폭(320px에서 296px)에서
 * 같은 가로 배치를 하면 텍스트 열에 114px만 남아 방 코드가 다시 넘친다.
 */
export function InvitePopover({ anchorRef, onClose, open, roomCode }: InvitePopoverProps) {
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
    <Popover anchorRef={anchorRef} label="친구 초대하기" onClose={onClose} open={open}>
      <div className="flex items-baseline justify-between pb-1">
        <h2 className="m-0 text-[17px] font-bold">친구 초대</h2>
        <button
          className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-content-muted hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
      </div>

      <div className="mt-3 grid justify-items-center gap-3">
        <QrFallback>
          <QRCodeSVG
            className="size-[8.5rem] rounded-card bg-white p-2"
            value={inviteUrl}
            level="M"
            marginSize={1}
            title={`방 ${roomCode} 초대 QR 코드`}
          />
        </QrFallback>
        {/* min-w-0 + w-full: 방 코드 최대 12자는 좁은 팝오버에서 넘친다 — truncate가 먹으려면
            grid 아이템의 최소폭이 내용 기준(auto)이 아니어야 한다(QA FND-4와 같은 함정). */}
        <div className="grid w-full min-w-0 justify-items-center gap-1">
          <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-content-muted uppercase">
            Room Code
          </span>
          <span className="block w-full truncate text-center font-mono text-[clamp(1.5rem,7vw,2.25rem)] leading-none font-bold tracking-[0.1em]">
            {roomCode}
          </span>
        </div>
        <p className="m-0 w-full min-w-0 truncate text-center font-mono text-[13px] text-content-muted">
          {inviteUrl}
        </p>
        <div className="flex w-full gap-2">
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

/**
 * `party`는 대시보드가 띄운 QR에만 붙는다 — 그 코드를 찍고 들어온 폰은 게임판이 아니라
 * 컨트롤러 화면으로 뜬다(room/partyControllerStorage).
 */
export function createInviteUrl(roomCode: string, { party = false } = {}) {
  const origin = typeof window === 'undefined' ? 'https://yorr.invalid' : window.location.origin
  return `${origin}/join?code=${encodeURIComponent(roomCode)}${party ? '&party=1' : ''}`
}

/** QR 렌더 실패 대비. 대시보드도 같은 폴백을 써야 큰 화면에서 빈 사각형만 남지 않는다. */
export class QrFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
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
