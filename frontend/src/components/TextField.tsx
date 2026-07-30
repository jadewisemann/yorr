import { type InputHTMLAttributes, type ReactNode, useId } from 'react'
import { cn } from '@/cn'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode
  helpText?: ReactNode
  errorMessage?: ReactNode
}

export function TextField({
  className,
  errorMessage,
  helpText,
  id,
  label,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const helpId = helpText ? `${inputId}-help` : undefined
  const errorId = errorMessage ? `${inputId}-error` : undefined
  const descriptionIds = [describedBy, helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="grid gap-2 text-left text-content">
      <label className="text-sm font-bold" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={cn(
          // 디자인 시스템 04 INPUT — 딥 서피스 위 화이트 포커스 링(1.5px 보더 + 4px 글로우).
          'min-h-14 w-full rounded-card border bg-surface px-4 py-3 text-[17px] text-content outline-none transition-[border-color,box-shadow] placeholder:text-content-faint focus-visible:border-focus focus-visible:ring-4 focus-visible:ring-focus/10 disabled:cursor-not-allowed disabled:opacity-55',
          errorMessage ? 'border-danger bg-brand/6' : 'border-border',
          className,
        )}
        aria-describedby={descriptionIds}
        aria-invalid={errorMessage ? true : invalid}
        {...props}
      />
      {helpText && (
        <span id={helpId} className="text-sm text-content-muted">
          {helpText}
        </span>
      )}
      {errorMessage && (
        <span id={errorId} className="text-sm font-medium text-danger" role="alert">
          {errorMessage}
        </span>
      )}
    </div>
  )
}
