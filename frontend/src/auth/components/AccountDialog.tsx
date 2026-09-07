import type { AuthSession } from '@/auth/authSession'
import { AccountMenu } from '@/auth/components/AccountDialog/AccountMenu'
import { ProviderChoice } from '@/auth/components/AccountDialog/ProviderChoice'
import { SupportLink } from '@/auth/components/AccountDialog/SupportLink'
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
  // 화면 테마는 여기 있었다가 랜딩 헤더로 나갔다(`landing/components/EntryPage/parts.tsx`) —
  // 계정 설정이 아니라 기기 설정이라 모달을 열지 않고 닿아야 한다.
  // 문의 창구는 계정이 아니라 서비스의 것이라 로그인 전후 어느 패널 아래에도 같은 자리에 둔다.
  const panel = (
    <>
      {session ? <AccountMenu onSignOut={onSignOut} session={session} /> : <ProviderChoice />}
      <SupportLink />
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
