import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

// ComponentProps라 ref도 그대로 통과한다 — 팝오버가 버튼에 붙으려면 앵커가 필요하다.
type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'cta'
  loading?: boolean
}

/**
 * 버튼 위계(디자인 시스템 03) — 한 화면에 레드 Primary는 하나.
 * Secondary는 아이보리 화이트, Tertiary(ghost)는 아웃라인, Danger는 레드 틴트 아웃라인.
 */
const variants = {
  primary: 'bg-brand text-on-brand shadow-cta hover:bg-brand-strong disabled:shadow-none',
  secondary: 'bg-inverse text-on-inverse hover:bg-white',
  // 테두리가 white/18(캔버스 위 1.62:1)이라 카탈로그에서 나란히 세우면 비활성 Primary
  // (brand/55 면, 2.10:1)가 이 활성 버튼보다 넓고 진하게 보인다. 글자는 제 밝기를 유지하니
  // 뜻이 뒤집히지는 않지만, 3순위 행동의 윤곽이 "누를 수 없는 것"보다 흐릴 이유는 없다.
  ghost: 'border-white/28 bg-transparent text-content hover:bg-surface-veil',
  danger: 'border-brand/55 bg-brand/10 text-danger hover:bg-brand/18',
} as const

// sm은 여백과 글자만 줄인다 — 높이는 네 사이즈 모두 min-h-tap 이상을 지킨다.
// cta는 화면 하단을 가로지르는 주 행동 버튼이다. 다섯 화면(대기실 시작·닉네임 입장·
// 결과 대기실 복귀·잘못된 초대·404)이 lg에 같은 세 유틸리티를 덧붙여 쓰고 있었다 —
// 사이즈로 승격해 그 반복을 한곳에 둔다. 폭은 화면마다 달라 여기서 정하지 않는다.
const sizes = {
  sm: 'min-h-tap px-3 py-1.5 text-sm',
  md: 'min-h-tap px-6 py-3',
  lg: 'min-h-12 px-8 py-3.5 text-lg',
  cta: 'min-h-[3.625rem] rounded-panel px-8 py-3.5 text-lg',
} as const

export function Button({
  children,
  className,
  disabled,
  loading = false,
  size = 'md',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        // 눌림은 뜬 것을 되돌리고(translate-y-0) 살짝 눌러 앉힌다 — 손가락이 닿은 순간
        // 화면이 반응했다는 걸 hover가 없는 터치에서도 알 수 있는 유일한 채널이다.
        'inline-flex items-center justify-center gap-2 rounded-card border border-transparent font-bold transition-[color,background-color,border-color,opacity,translate,scale] duration-150 ease-snappy hover:not-disabled:-translate-y-px active:not-disabled:translate-y-0 active:not-disabled:scale-[0.97] focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="size-4 animate-spin-slow rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
