import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../cn'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const variants = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'border-border bg-surface-raised text-content hover:border-brand',
  ghost: 'bg-transparent text-content hover:bg-surface-raised',
} as const

const sizes = {
  sm: 'min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-tap px-6 py-3',
  lg: 'min-h-12 px-8 py-3.5 text-lg',
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
        'inline-flex items-center justify-center gap-2 rounded-card border border-transparent font-bold transition-[color,background-color,border-color,opacity,translate] duration-150 ease-snappy hover:not-disabled:-translate-y-px focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55',
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
