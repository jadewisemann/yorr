import { useEffect, useRef } from 'react'
import { useDialogBackground } from '@/useDialogBackground'
import { BottomSheet } from './BottomSheet'
import { LandingRoomCodePanel } from './LandingRoomCodePanel'

interface LandingCodeDialogProps {
  code: string
  /** wide = 헤더 버튼 아래 팝오버, narrow = 바텀시트. */
  layout: 'narrow' | 'wide'
  onClose: () => void
  onCodeChange: (code: string) => void
  onSubmit: () => void
  open: boolean
}

const DIALOG_LABEL = '초대받은 방에 참가'

/**
 * 코드 입력 껍데기. 두 레이아웃 모두 `<main>` 밖에 그린다 — `useDialogBackground`가
 * 배경 `<main>`에 `inert`를 걸어 뒤 화면을 무력화하므로, 안에 있으면 자기 자신이 잠긴다.
 */
export function LandingCodeDialog({
  code,
  layout,
  onClose,
  onCodeChange,
  onSubmit,
  open,
}: LandingCodeDialogProps) {
  if (layout === 'narrow') {
    return (
      <BottomSheet
        className="h-auto gap-4 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
        onClose={onClose}
        open={open}
        title={DIALOG_LABEL}
      >
        <LandingRoomCodePanel
          code={code}
          layout="narrow"
          onClose={onClose}
          onCodeChange={onCodeChange}
          onSubmit={onSubmit}
        />
      </BottomSheet>
    )
  }

  return (
    <CodePopover
      code={code}
      onClose={onClose}
      onCodeChange={onCodeChange}
      onSubmit={onSubmit}
      open={open}
    />
  )
}

/** 헤더의 "방 코드로 참가" 버튼에 꼬리를 물린 팝오버. 배경 무력화는 훅이 맡는다. */
function CodePopover({
  code,
  onClose,
  onCodeChange,
  onSubmit,
  open,
}: Omit<LandingCodeDialogProps, 'layout'>) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useDialogBackground(open)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    // 코드를 입력하러 열었으므로 입력란에서 시작한다. 패널 첫 요소가 곧 입력란이다.
    panelRef.current?.querySelector<HTMLElement>('input')?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-modal">
      <button
        aria-label="배경을 눌러 닫기"
        className="absolute inset-0 cursor-default border-0 bg-scrim"
        onClick={onClose}
        type="button"
      />
      <div
        // 패널이 자체 제목을 그리므로 여기서 또 heading을 만들지 않는다.
        aria-label={DIALOG_LABEL}
        aria-modal="true"
        className="absolute top-26 right-11 w-98 rounded-[20px] border border-landing-hairline-strong bg-surface-raised p-6 shadow-landing-popover"
        ref={panelRef}
        role="dialog"
      >
        <span
          aria-hidden="true"
          className="absolute -top-[7px] right-13 size-3.5 rotate-45 border-t border-l border-landing-hairline-strong bg-surface-raised"
        />
        <LandingRoomCodePanel
          code={code}
          layout="wide"
          onClose={onClose}
          onCodeChange={onCodeChange}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  )
}
