import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/shared/components/Button'
import { Screen } from '@/shared/components/Screen'

export function NotFoundPage() {
  const navigate = useNavigate()
  const path = typeof window === 'undefined' ? '' : window.location.pathname

  return (
    <Screen className="max-w-lg">
      <header className="pt-2">
        <span className="font-mono text-xl leading-none font-bold tracking-[-0.03em]">
          YO<span className="text-brand">R</span>R
        </span>
      </header>

      <div className="my-auto grid gap-4">
        <span
          aria-hidden="true"
          className="font-mono text-[4rem] leading-none font-bold tracking-[-0.04em] text-surface-overlay"
        >
          404
        </span>
        <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">페이지를 찾을 수 없습니다</h1>
        <p className="m-0 text-sm leading-[1.6] text-content-muted">
          주소가 바뀌었거나 만료된 링크일 수 있어요. 홈에서 방을 새로 만들거나 초대 코드로 참가해
          주세요.
        </p>
        {path && (
          <p className="m-0 flex items-center gap-2 rounded-card border border-border bg-surface px-3.5 py-3">
            <span
              aria-hidden="true"
              className="grid size-5 flex-none place-items-center rounded-chip bg-border text-2xs leading-none font-bold"
            >
              i
            </span>
            <span className="truncate font-mono text-xs text-content-muted">{path}</span>
          </p>
        )}
      </div>

      <Button
        className="w-full"
        size="cta"
        onClick={() => void navigate({ to: '/' })}
        type="button"
      >
        홈으로
      </Button>
    </Screen>
  )
}
