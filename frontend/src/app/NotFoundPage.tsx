import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/shared/components/Button'

/** 디자인 26 — 알 수 없는 경로의 시스템 페이지. 큰 404는 장식이라 흐린 잉크로 깔아둔다. */
export function NotFoundPage() {
  const navigate = useNavigate()
  const path = typeof window === 'undefined' ? '' : window.location.pathname

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-gutter pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <header className="pt-2">
        <span className="font-mono text-[22px] leading-none font-bold tracking-[-0.03em]">
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
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em]">페이지를 찾을 수 없습니다</h1>
        <p className="m-0 text-[15px] leading-[1.6] text-content-muted">
          주소가 바뀌었거나 만료된 링크일 수 있어요. 홈에서 방을 새로 만들거나 초대 코드로 참가해
          주세요.
        </p>
        {path && (
          <p className="m-0 flex items-center gap-2.5 rounded-card border border-border bg-surface px-3.5 py-3">
            <span
              aria-hidden="true"
              className="grid size-5 flex-none place-items-center rounded-[6px] bg-white/10 text-[11px] leading-none font-bold"
            >
              i
            </span>
            <span className="truncate font-mono text-[13px] text-content-muted">{path}</span>
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
    </main>
  )
}
