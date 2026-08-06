import { googleLoginUrl, kakaoLoginUrl } from '@/auth/api/authApi'
import { cn } from '@/shared/cn'
import { activeRow, row } from './rowStyles'

/**
 * 계정 껍데기. 로그인 전에는 <b>로그인 수단 고르기</b>, 로그인 후에는 <b>내 계정 메뉴</b>다.
 * <p>
 * 헤더에 제공자 버튼(카카오)을 바로 두지 않는 이유가 둘 있다. 하나는 곧 구글이 붙기 때문에
 * 자리를 제공자 하나에 내줄 수 없어서고, 다른 하나는 어두운 랜딩 위에 브랜드 노란색을
 * 그대로 얹으면 화면에서 그것만 튀기 때문이다. 브랜드 색은 <b>고르는 자리 안에서만</b> 쓴다.
 */
/**
 * 제공자 표시. 브랜드 색은 이 작은 칩 안에만 두어 어두운 화면에서 튀지 않게 한다.
 */
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
  return (
    <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-2xs font-semibold text-content-faint">
      준비 중
    </span>
  )
}

export function ProviderChoice() {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-xs/[1.5] text-content-muted">
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
      <button
        className={cn(row, activeRow)}
        onClick={() => globalThis.location.assign(googleLoginUrl())}
        type="button"
      >
        <ProviderMark provider="google" />
        구글로 계속하기
      </button>
      {/*
        카카오 세션은 브라우저에 남아 있어, 우리 쪽에서 로그아웃해도 위 버튼은 동의 화면 없이
        바로 통과한다. 그게 보통은 편하지만 계정을 바꾸려는 사람에게는 길이 막힌 셈이라
        여기서만 재인증을 요청한다.
      */}
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
