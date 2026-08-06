import type { AuthSession } from '@/auth/authSession'
import { AccountMenu } from '@/auth/components/AccountDialog/AccountMenu'
import { ProviderChoice } from '@/auth/components/AccountDialog/ProviderChoice'
import { BottomSheet } from '@/shared/components/BottomSheet'
import { Popover } from '@/shared/components/Popover'

interface AccountDialogProps {
  layout: 'narrow' | 'wide'
  onClose: () => void
  onSignOut: () => void
  open: boolean
  session: AuthSession | null
}

/**
 * 계정 껍데기. 로그인 전에는 <b>로그인 수단 고르기</b>, 로그인 후에는 <b>내 계정 메뉴</b>다.
 * <p>
 * 헤더에 제공자 버튼(카카오)을 바로 두지 않는 이유가 둘 있다. 하나는 곧 구글이 붙기 때문에
 * 자리를 제공자 하나에 내줄 수 없어서고, 다른 하나는 어두운 랜딩 위에 브랜드 노란색을
 * 그대로 얹으면 화면에서 그것만 튀기 때문이다. 브랜드 색은 <b>고르는 자리 안에서만</b> 쓴다.
 */
export function AccountDialog({ layout, onClose, onSignOut, open, session }: AccountDialogProps) {
  const label = session ? '내 계정' : '로그인'
  const panel = session ? (
    <AccountMenu onSignOut={onSignOut} session={session} />
  ) : (
    <ProviderChoice />
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
