import { kakaoLoginUrl } from '@/api/authApi'
import type { AuthSession } from '@/authSession'
import { cn } from '@/cn'
import { BottomSheet } from './BottomSheet'
import { LandingPopover } from './LandingPopover'

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
    <LandingPopover focusSelector="button" label={label} onClose={onClose} open={open}>
      <div className="grid gap-4">
        <h2 className="m-0 text-[17px]/none font-bold text-content">{label}</h2>
        {panel}
      </div>
    </LandingPopover>
  )
}

const row =
  'flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3.5 text-left text-[15px] font-semibold text-content transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2'
const activeRow = 'cursor-pointer hover:border-landing-hairline-strong hover:bg-surface-raised'
const lockedRow = 'cursor-not-allowed text-content-faint'

function ProviderChoice() {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-[13px]/[1.5] text-content-muted">
        로그인하면 전적과 프로필이 계정에 남아요. 로그인 없이도 바로 플레이할 수 있어요.
      </p>
      <button
        className={cn(row, activeRow)}
        // fetch가 아니라 전체 페이지 이동이어야 한다 — 서버가 카카오로 302를 보내고,
        // 사용자는 카카오 화면에서 직접 동의해야 한다.
        onClick={() => globalThis.location.assign(kakaoLoginUrl())}
        type="button"
      >
        <ProviderMark provider="kakao" />
        카카오로 계속하기
      </button>
      <button className={cn(row, lockedRow)} disabled type="button">
        <ProviderMark provider="google" />
        구글로 계속하기
        <ComingSoonPill />
      </button>
    </div>
  )
}

function AccountMenu({ onSignOut, session }: { onSignOut: () => void; session: AuthSession }) {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3.5">
        <Avatar nickname={session.nickname} size="lg" />
        <span className="grid min-w-0 gap-0.5">
          <strong className="truncate text-[15px] font-bold text-content">
            {session.nickname}
          </strong>
          <span className="text-[12.5px] text-content-muted">로그인됨</span>
        </span>
      </div>
      {/* 프로필·전적 화면이 붙을 자리를 미리 비워 둔다 — 지금은 무엇이 올지 보이는 것만으로 충분하다. */}
      <button className={cn(row, lockedRow)} disabled type="button">
        프로필 관리
        <ComingSoonPill />
      </button>
      <button className={cn(row, lockedRow)} disabled type="button">
        내 전적
        <ComingSoonPill />
      </button>
      <button className={cn(row, activeRow)} onClick={onSignOut} type="button">
        로그아웃
      </button>
    </div>
  )
}

function ComingSoonPill() {
  return (
    <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-content-faint">
      준비 중
    </span>
  )
}

/** 닉네임 첫 글자를 딴 원형 아바타. 프로필 이미지가 붙기 전까지의 자리다. */
export function Avatar({ nickname, size }: { nickname: string; size: 'lg' | 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none items-center justify-center rounded-full bg-landing-accent-tint font-bold text-landing-accent-text',
        size === 'lg' ? 'size-9 text-[15px]' : 'size-6 text-[12px]',
      )}
    >
      {[...nickname][0] ?? '?'}
    </span>
  )
}

/**
 * 제공자 표시. 브랜드 색은 이 작은 칩 안에만 두어 어두운 화면에서 튀지 않게 한다.
 */
function ProviderMark({ provider }: { provider: 'google' | 'kakao' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 flex-none items-center justify-center rounded-[9px] text-[13px] font-bold',
        provider === 'kakao'
          ? 'bg-kakao text-kakao-ink'
          : 'border border-border text-content-faint',
      )}
    >
      {provider === 'kakao' ? (
        <span className="size-3 rounded-[50%_50%_50%_15%] border-[2px] border-current" />
      ) : (
        'G'
      )}
    </span>
  )
}
