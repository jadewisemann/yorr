import { BottomSheet } from './BottomSheet'
import { LandingPopover } from './LandingPopover'
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

/** 코드 입력 껍데기. 팝오버·바텀시트 공통 동작은 각 껍데기 컴포넌트가 맡는다. */
export function LandingCodeDialog({
  code,
  layout,
  onClose,
  onCodeChange,
  onSubmit,
  open,
}: LandingCodeDialogProps) {
  const panel = (panelLayout: 'narrow' | 'wide') => (
    <LandingRoomCodePanel
      code={code}
      layout={panelLayout}
      onClose={onClose}
      onCodeChange={onCodeChange}
      onSubmit={onSubmit}
    />
  )

  if (layout === 'narrow') {
    return (
      <BottomSheet
        className="h-auto gap-4 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
        onClose={onClose}
        open={open}
        title={DIALOG_LABEL}
      >
        {panel('narrow')}
      </BottomSheet>
    )
  }

  return (
    // 코드를 입력하러 열었으므로 입력란에서 시작한다.
    <LandingPopover focusSelector="input" label={DIALOG_LABEL} onClose={onClose} open={open}>
      {panel('wide')}
    </LandingPopover>
  )
}
