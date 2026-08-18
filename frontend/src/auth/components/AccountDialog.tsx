import type { AuthSession } from '@/auth/authSession'
import { AccountMenu } from '@/auth/components/AccountDialog/AccountMenu'
import { ProviderChoice } from '@/auth/components/AccountDialog/ProviderChoice'
import { ThemeRow } from '@/auth/components/AccountDialog/ThemeRow'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Popover } from '@/shared/components/Popover'

interface AccountDialogProps {
  layout: 'narrow' | 'wide'
  onClose: () => void
  onSignOut: () => void
  open: boolean
  session: AuthSession | null
}

export function AccountDialog({ layout, onClose, onSignOut, open, session }: AccountDialogProps) {
  const label = session ? '내 계정' : '로그인'
  const panel = (
    <>
      {session ? <AccountMenu onSignOut={onSignOut} session={session} /> : <ProviderChoice />}
      <ThemeRow />
    </>
  )

  if (layout === 'narrow') {
    return (
      <BottomSheet
        className="h-auto gap-4 bg-surface-raised pb-[max(24px,env(safe-area-inset-bottom))]"
        onClose={onClose}
        open={open}
        title={label}
      >
        {panel}
      </BottomSheet>
    )
  }

  return (
    <Popover focusSelector="button" label={label} onClose={onClose} open={open}>
      <div className="grid gap-4">
        <h2 className="m-0 text-base/none font-bold text-content">{label}</h2>
        {panel}
      </div>
    </Popover>
  )
}
