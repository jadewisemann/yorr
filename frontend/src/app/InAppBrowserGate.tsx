import { type ReactNode, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { IconCheck, IconWarning } from '@/shared/components/Icon'
import { Panel } from '@/shared/components/Panel'
import { Screen } from '@/shared/components/Screen'

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
    } catch {}
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
    <Screen className="max-w-lg gap-6 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="grid gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">외부 브라우저를 권장해요</h1>
        <p className="m-0 text-sm leading-[1.6] text-content-muted">
          Chrome 또는 Safari에서 열면 흔들기 센서와 링크 공유가 안정적으로 동작해요. 인앱
          브라우저에서는 일부 기능이 제한될 수 있어요.
        </p>
      </div>

      <Panel as="ul" className="m-0 grid list-none gap-2 p-4 text-sm">
        <ChecklistItem tone="ok">흔들어서 주사위 굴리기</ChecklistItem>
        <ChecklistItem tone="ok">초대 링크 공유와 복사</ChecklistItem>
        <ChecklistItem tone="warn">인앱에서는 센서가 동작하지 않을 수 있어요</ChecklistItem>
      </Panel>

      <div className="mt-auto grid gap-2">
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
    </Screen>
  )
}

const checklistTone = {
  ok: { Icon: IconCheck, badge: 'bg-positive/20 text-positive', row: undefined },
  warn: { Icon: IconWarning, badge: 'bg-warning/20 text-warning', row: 'text-content-muted' },
} as const

function ChecklistItem({
  children,
  tone,
}: {
  children: ReactNode
  tone: keyof typeof checklistTone
}) {
  const { badge, Icon, row } = checklistTone[tone]

  return (
    <li className={cn('flex items-center gap-2', row)}>
      <span
        aria-hidden="true"
        className={cn('grid size-[18px] flex-none place-items-center rounded-chip', badge)}
      >
        <Icon className="size-3" />
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
