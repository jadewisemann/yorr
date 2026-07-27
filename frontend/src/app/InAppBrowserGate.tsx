import { type ReactNode, useState } from 'react'
import { Button } from '@/components/Button'

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
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-5 rounded-panel border border-border bg-surface p-6 text-center shadow-raised">
        <h1 className="m-0 text-display font-bold text-content">외부 브라우저를 권장해요</h1>
        <p className="m-0 text-content-muted">
          카메라·센서와 공유 기능을 안정적으로 사용하려면 Chrome 또는 Safari에서 열어 주세요.
        </p>
        {externalUrl && (
          <a
            className="inline-flex min-h-tap items-center justify-center rounded-card bg-brand px-6 py-3 font-bold text-on-brand"
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
        <Button type="button" variant="ghost" onClick={continueHere}>
          그냥 진행
        </Button>
      </section>
    </main>
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
