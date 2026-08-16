import { googleLoginUrl, kakaoLoginUrl } from '@/auth/api/authApi'
import { cn } from '@/shared/cn'
import { Badge } from '@/shared/components/Badge'
import { activeRow, row } from './rowStyles'

export function ProviderMark({ provider }: { provider: 'google' | 'kakao' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 flex-none items-center justify-center rounded-control text-xs font-bold',
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

export function ComingSoonPill() {
  return <Badge className="ml-auto font-semibold text-content-faint">준비 중</Badge>
}

export function ProviderChoice() {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-xs/[1.5] text-content-muted">
        로그인하면 전적과 프로필이 계정에 남아요. 로그인 없이도 바로 플레이할 수 있어요.
      </p>
      <button
        className={cn(row, activeRow)}
        onClick={() => globalThis.location.assign(kakaoLoginUrl())}
        type="button"
      >
        <ProviderMark provider="kakao" />
        카카오로 계속하기
      </button>
      <button
        className={cn(row, activeRow)}
        onClick={() => globalThis.location.assign(googleLoginUrl())}
        type="button"
      >
        <ProviderMark provider="google" />
        구글로 계속하기
      </button>
      <button
        className="min-h-tap cursor-pointer justify-self-center rounded-full border-0 bg-transparent px-3 py-1 text-xs font-semibold text-content-muted underline-offset-2 hover:text-content hover:underline focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable"
        onClick={() => globalThis.location.assign(kakaoLoginUrl({ forceLogin: true }))}
        type="button"
      >
        다른 계정으로 로그인
      </button>
    </div>
  )
}
