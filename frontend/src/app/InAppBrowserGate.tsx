import { type ReactNode, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'

const dismissalKey = 'yorr.in-app-browser-dismissed'

export function InAppBrowserGate({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const isInApp = detectInAppBrowser(userAgent)

  if (!isInApp || dismissed) return children

  const continueHere = () => {
    try {
      sessionStorage.setItem(dismissalKey, 'true')
    } catch {
      // Embedded browsers may block storage; local state still dismisses the gate.
    }
    setDismissed(true)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyMessage('현재 링크를 복사했어요.')
    } catch {
      setCopyMessage(
        `자동 복사에 실패했어요. 이 주소를 길게 눌러 복사해 주세요: ${window.location.href}`,
      )
    }
  }

  const externalUrl = getAndroidExternalUrl(userAgent)

  return (
    // 디자인 14 — 좌측 정렬 풀스크린 안내. 무엇이 되고 무엇이 제한되는지 체크리스트로 보여준다.
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-gutter pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <div className="grid gap-3">
        <h1 className="m-0 text-[27px] font-bold tracking-[-0.02em]">외부 브라우저를 권장해요</h1>
        <p className="m-0 text-[15px] leading-[1.6] text-content-muted">
          Chrome 또는 Safari에서 열면 흔들기 센서와 링크 공유가 안정적으로 동작해요. 인앱
          브라우저에서는 일부 기능이 제한될 수 있어요.
        </p>
      </div>

      <ul className="m-0 grid list-none gap-2.5 rounded-panel border border-border bg-surface p-4 text-sm">
        <ChecklistItem tone="ok">흔들어서 주사위 굴리기</ChecklistItem>
        <ChecklistItem tone="ok">초대 링크 공유와 복사</ChecklistItem>
        <ChecklistItem tone="warn">인앱에서는 센서가 동작하지 않을 수 있어요</ChecklistItem>
      </ul>

      <div className="mt-auto grid gap-2.5">
        {externalUrl && (
          <a
            className="inline-flex min-h-[3.625rem] items-center justify-center rounded-panel bg-brand px-6 py-3 text-lg font-bold text-on-brand shadow-cta"
            href={externalUrl}
          >
            Chrome에서 열기
          </a>
        )}
        <Button type="button" variant="secondary" onClick={copyLink}>
          현재 링크 복사
        </Button>
        {copyMessage && (
          <p className="m-0 break-all text-sm text-content-muted" role="status" aria-live="polite">
            {copyMessage}
          </p>
        )}
        <Button
          className="text-content-muted hover:text-content"
          type="button"
          variant="ghost"
          onClick={continueHere}
        >
          그냥 진행
        </Button>
      </div>
    </main>
  )
}

/** 체크리스트 한 줄. 세 줄이 같은 배지를 쓰고 색과 글리프만 갈린다. */
const checklistTone = {
  ok: { glyph: '✓', badge: 'bg-positive/20 text-positive', row: undefined },
  warn: { glyph: '!', badge: 'bg-warning/20 text-warning', row: 'text-content-muted' },
} as const

function ChecklistItem({
  children,
  tone,
}: {
  children: ReactNode
  tone: keyof typeof checklistTone
}) {
  const { badge, glyph, row } = checklistTone[tone]

  return (
    <li className={cn('flex items-center gap-2.5', row)}>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-[18px] flex-none place-items-center rounded-[6px] text-[10px] leading-none font-bold',
          badge,
        )}
      >
        {glyph}
      </span>
      {children}
    </li>
  )
}

export function detectInAppBrowser(userAgent: string) {
  return /(KAKAOTALK|Instagram|FBAN|FBAV|NAVER|Line\/|DaumApps|Twitter)/i.test(userAgent)
}

function readDismissed() {
  try {
    return sessionStorage.getItem(dismissalKey) === 'true'
  } catch {
    return false
  }
}

function getAndroidExternalUrl(userAgent: string) {
  if (typeof window === 'undefined' || !/Android/i.test(userAgent)) return null
  const url = new URL(window.location.href)
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;end`
}
