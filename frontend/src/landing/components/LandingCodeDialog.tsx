import type { RefObject } from 'react'
import { Popover } from '@/shared/components/Popover'
import { LandingRoomCodePanel } from './LandingRoomCodePanel'

interface LandingCodeDialogProps {
  anchorRef?: RefObject<HTMLElement | null> | undefined
  code: string
  layout: 'narrow' | 'wide'
  onClose: () => void
  onCodeChange: (code: string) => void
  onSubmit: () => void
  open: boolean
}

const DIALOG_LABEL = '초대받은 방에 참가'

export function LandingCodeDialog({
  anchorRef,
  code,
  layout,
  onClose,
  onCodeChange,
  onSubmit,
  open,
}: LandingCodeDialogProps) {
  const narrow = layout === 'narrow'
  return (
    <Popover
      anchorRef={anchorRef}
      className={narrow ? 'p-4' : undefined}
      focusSelector="input"
      label={DIALOG_LABEL}
      onClose={onClose}
      open={open}
      width={narrow ? 336 : undefined}
    >
      <LandingRoomCodePanel
        code={code}
        layout={layout}
        onClose={onClose}
        onCodeChange={onCodeChange}
        onSubmit={onSubmit}
      />
    </Popover>
  )
}
