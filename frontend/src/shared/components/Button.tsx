import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg' | 'cta'
  loading?: boolean
}

const variants = {
  primary: 'bg-brand text-on-brand shadow-cta hover:bg-brand-strong disabled:shadow-none',
  secondary: 'bg-inverse text-on-inverse hover:bg-white',
  ghost: 'border-white/28 bg-transparent text-content hover:bg-surface-veil',
  danger: 'border-brand/55 bg-brand/10 text-danger hover:bg-brand/18',
} as const

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
        'inline-flex items-center justify-center gap-2 rounded-card border border-transparent font-bold transition-[color,background-color,border-color,opacity,translate,scale] duration-150 ease-snappy hover:not-disabled:-translate-y-px active:not-disabled:translate-y-0 pressable focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55',
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
