import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import type { MotionGestureConfig } from '@/yacht/input/motionConfig'
import type { MotionAvailability, MotionGestureState } from '@/yacht/input/motionTypes'
import { MotionLabChart } from './MotionLabChart'
import { MotionLabEventLog } from './MotionLabEventLog'
import { MotionLabParamsPanel } from './MotionLabParamsPanel'
import { MotionLabRecorder } from './MotionLabRecorder'
import { copyTextToClipboard } from './motionLabClipboard'
import { formatConfigAsJson, formatConfigAsTs, formatConfigDiff } from './motionLabParams'
import { useMotionLab } from './useMotionLab'

const sectionClassName = 'grid gap-4 rounded-panel border border-border bg-surface p-5'

const AVAILABILITY_META: Record<
  MotionAvailability,
  { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; help: string }
> = {
  unknown: { label: '초기화 중', tone: 'muted', help: '센서 상태를 확인하고 있어요.' },
  permissionRequired: {
    label: '시작 대기',
    tone: 'warn',
    help: '아래 버튼을 누르면 센서를 시작해요. 센서값은 이 기기 안에서만 쓰여요.',
  },
  requesting: { label: '권한 요청 중', tone: 'warn', help: '브라우저 권한 창을 확인해 주세요.' },
  listening: { label: '수신 중', tone: 'ok', help: '기기를 흔들거나 앞으로 스냅해 보세요.' },
  insecure: {
    label: 'HTTPS 필요',
    tone: 'bad',
    help: '모션 센서는 HTTPS로 접속했을 때만 동작해요. 배포 주소로 접속해 주세요.',
  },
  unsupported: {
    label: '센서 미지원',
    tone: 'bad',
    help: '이 기기에는 모션 센서가 없어요. 녹화 가져오기·리플레이는 그대로 쓸 수 있어요.',
  },
  denied: {
    label: '권한 거부됨',
    tone: 'bad',
    help: '브라우저 사이트 설정에서 동작 센서를 허용한 뒤 페이지를 새로 열어 주세요.',
  },
  silent: {
    label: '신호 없음',
    tone: 'warn',
    help: '센서는 켜졌지만 샘플이 오지 않아요. 실기기인지, 다른 앱이 점유 중인지 확인해 주세요.',
  },
  paused: { label: '일시정지', tone: 'muted', help: '화면이 백그라운드로 가면 판정을 멈춰요.' },
  error: { label: '오류', tone: 'bad', help: '권한 요청이 실패했어요. 페이지를 새로 열어 주세요.' },
}

const TONE_CLASS = {
  ok: 'border-positive/60 text-positive',
  warn: 'border-brand/60 text-brand-strong',
  bad: 'border-danger/60 text-danger',
  muted: 'border-border text-content-muted',
} as const

const GESTURE_LABEL: Record<MotionGestureState, string> = {
  calibrating: '캘리브레이션 중',
  idle: '대기',
  shakeCandidate: '흔들기 후보',
  shaking: '흔들기 중',
  armed: '던지기 대기',
  thrown: '던짐!',
  cooldown: '쿨다운',
}

const THRESHOLD_ROWS = [
  { key: 'shakePeak', configKey: 'shakePeakThreshold', label: '흔들기 피크' },
  { key: 'shakePeakRelease', configKey: 'shakePeakReleaseThreshold', label: '피크 해제' },
  { key: 'shakeMinRms', configKey: 'shakeMinRms', label: '최소 RMS' },
  { key: 'throwPeak', configKey: 'throwPeakThreshold', label: '던지기 피크' },
  { key: 'throwImpulse', configKey: 'throwImpulseThreshold', label: '임펄스' },
  { key: 'throwJerk', configKey: 'throwJerkThreshold', label: '저크' },
] as const

export function MotionLab() {
  const lab = useMotionLab()
  const meta = AVAILABILITY_META[lab.availability]

  const [vibrateOn, setVibrateOn] = useState(false)
  const [keepAwake, setKeepAwake] = useState(false)
  const [flash, setFlash] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [fallbackText, setFallbackText] = useState<string | null>(null)

  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator
  const canWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useFeedback(lab.events[0]?.id, lab.events[0]?.event.type, vibrateOn && canVibrate, setFlash)
  useWakeLock(keepAwake && canWakeLock)

  const copyConfig = async (kind: 'ts' | 'json' | 'diff') => {
    const text = formatConfig(kind, lab.config)
    if (kind === 'diff' && text === '') {
      setCopyMessage('기본값과 다른 항목이 없어요.')
      setFallbackText(null)
      return
    }
    const ok = await copyTextToClipboard(text)
    setCopyMessage(copyResultMessage(ok, kind))
    setFallbackText(ok ? null : text)
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-content gap-5 p-4 pb-10 text-content">
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-0 z-50 bg-brand transition-opacity duration-300',
          flash ? 'opacity-30' : 'opacity-0',
        )}
      />

      <header className="grid gap-1">
        <p className="m-0 text-sm font-bold tracking-widest text-brand-strong">YORR MOTION LAB</p>
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 text-display font-bold">모션 센서 튜닝</h1>
          <span
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm font-bold',
              TONE_CLASS[meta.tone],
            )}
          >
            {meta.label}
          </span>
        </div>
        <p className="m-0 text-sm text-content-muted">
          흔들기·던지기 판정 파라미터를 실기기에서 실시간으로 조절하고, 확정값을 복사해
          motionConfig.ts에 붙여넣는 개발 전용 페이지예요. 센서값은 서버로 보내지 않아요.
        </p>
      </header>

      <SensorStatusSection
        availability={lab.availability}
        help={meta.help}
        requestPermission={lab.requestPermission}
        canVibrate={canVibrate}
        vibrateOn={vibrateOn}
        setVibrateOn={setVibrateOn}
        canWakeLock={canWakeLock}
        keepAwake={keepAwake}
        setKeepAwake={setKeepAwake}
      />

      <section className={sectionClassName} aria-label="실시간 모니터">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-brand/60 px-3 py-1 text-sm font-bold text-brand-strong">
            {lab.snapshot ? GESTURE_LABEL[lab.snapshot.gestureState] : '대기'}
          </span>
          <span className="text-sm text-content-muted">
            반전 {lab.snapshot?.reversalCount ?? 0}회 · 노이즈 RMS{' '}
            {(lab.snapshot?.noiseRms ?? 0).toFixed(2)} · {lab.stats.sampleRateHz}Hz
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="수평" value={lab.stats.horizontal} />
          <Metric label="전방" value={lab.stats.forward} />
          <Metric label="크기" value={lab.stats.magnitude} />
        </div>
        <MotionLabChart
          bufferRef={lab.chartBufferRef}
          field="horizontal"
          label="수평 가속도 (흔들기)"
          threshold={lab.snapshot?.effectiveThresholds.shakePeak ?? lab.config.shakePeakThreshold}
          releaseThreshold={
            lab.snapshot?.effectiveThresholds.shakePeakRelease ??
            lab.config.shakePeakReleaseThreshold
          }
          symmetric
        />
        <MotionLabChart
          bufferRef={lab.chartBufferRef}
          field="forward"
          label="전방 가속도 (던지기)"
          threshold={lab.snapshot?.effectiveThresholds.throwPeak ?? lab.config.throwPeakThreshold}
        />
        <ThresholdTable config={lab.config} snapshot={lab.snapshot} />
      </section>

      <MotionLabRecorder
        canRecord={lab.availability === 'listening'}
        isRecording={lab.isRecording}
        onStartRecording={lab.startRecording}
        onStopRecording={lab.stopRecording}
        recording={lab.lastRecording}
        onLoadRecording={lab.loadRecording}
        config={lab.config}
      />

      <MotionLabEventLog events={lab.events} onClear={lab.clearEvents} />

      <MotionLabParamsPanel config={lab.config} onApply={lab.applyConfig} />

      <section className={sectionClassName} aria-label="설정 내보내기">
        <h2 className="m-0 text-xl font-bold">설정 내보내기</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void copyConfig('ts')}>
            TS 복사 (motionConfig.ts용)
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copyConfig('json')}>
            JSON 복사
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copyConfig('diff')}>
            변경분만 복사
          </Button>
        </div>
        {copyMessage && (
          <p className="m-0 text-sm text-content-muted" role="status" aria-live="polite">
            {copyMessage}
          </p>
        )}
        {fallbackText && (
          <textarea
            readOnly
            className="min-h-40 w-full rounded-card border border-border bg-surface-sunken p-2 font-mono text-xs text-content"
            value={fallbackText}
            aria-label="복사 폴백 텍스트"
          />
        )}
      </section>
    </main>
  )
}

function formatConfig(kind: 'ts' | 'json' | 'diff', config: MotionGestureConfig) {
  if (kind === 'ts') return formatConfigAsTs(config)
  if (kind === 'json') return formatConfigAsJson(config)
  return formatConfigDiff(config)
}

function copyResultMessage(ok: boolean, kind: 'ts' | 'json' | 'diff') {
  if (!ok) return '자동 복사에 실패했어요. 아래 내용을 길게 눌러 복사해 주세요.'
  if (kind === 'ts') {
    return 'TS 리터럴을 복사했어요. motionConfig.ts의 MOTION_GESTURE_CONFIG 선언과 바꿔치기하세요.'
  }
  return '복사했어요.'
}

function SensorStatusSection({
  availability,
  help,
  requestPermission,
  canVibrate,
  vibrateOn,
  setVibrateOn,
  canWakeLock,
  keepAwake,
  setKeepAwake,
}: {
  availability: MotionAvailability
  help: string
  requestPermission: () => Promise<void>
  canVibrate: boolean
  vibrateOn: boolean
  setVibrateOn: (enabled: boolean) => void
  canWakeLock: boolean
  keepAwake: boolean
  setKeepAwake: (enabled: boolean) => void
}) {
  const canStart = availability === 'permissionRequired' || availability === 'requesting'
  const canRetry = ['denied', 'error', 'silent'].includes(availability)

  return (
    <section className={sectionClassName} aria-label="센서 상태">
      <p className="m-0 text-sm text-content-muted">{help}</p>
      {canStart && (
        <Button loading={availability === 'requesting'} onClick={() => void requestPermission()}>
          {availability === 'requesting' ? '권한 확인 중' : '센서 시작하기'}
        </Button>
      )}
      {canRetry && (
        <Button variant="secondary" onClick={() => void requestPermission()}>
          다시 시도
        </Button>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        {canVibrate && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={vibrateOn}
              onChange={(event) => setVibrateOn(event.target.checked)}
            />
            이벤트 진동 피드백
          </label>
        )}
        {canWakeLock && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={keepAwake}
              onChange={(event) => setKeepAwake(event.target.checked)}
            />
            화면 꺼짐 방지
          </label>
        )}
      </div>
      <DeviceInfo />
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-0.5 rounded-card border border-border bg-surface-raised px-2 py-2">
      <span className="text-xs text-content-muted">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value.toFixed(2)}</span>
    </div>
  )
}

function ThresholdTable({
  config,
  snapshot,
}: {
  config: MotionGestureConfig
  snapshot: ReturnType<typeof useMotionLab>['snapshot']
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="mb-1 caption-top text-left text-xs text-content-muted">
          유효 임계값 — 노이즈 캘리브레이션이 config보다 크게 잡으면 강조돼요.
        </caption>
        <thead>
          <tr className="text-left text-xs text-content-muted">
            <th className="py-1 pr-2 font-normal">임계값</th>
            <th className="py-1 pr-2 font-normal">config</th>
            <th className="py-1 font-normal">유효값</th>
          </tr>
        </thead>
        <tbody>
          {THRESHOLD_ROWS.map((row) => {
            const configValue = config[row.configKey]
            const effectiveValue = snapshot?.effectiveThresholds[row.key]
            const raised = effectiveValue !== undefined && effectiveValue > configValue
            return (
              <tr key={row.key} className="border-t border-border">
                <td className="py-1 pr-2">{row.label}</td>
                <td className="py-1 pr-2 tabular-nums text-content-muted">{configValue}</td>
                <td className={cn('py-1 tabular-nums', raised && 'font-bold text-danger')}>
                  {effectiveValue === undefined ? '—' : effectiveValue.toFixed(2)}
                  {raised && ' ↑'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DeviceInfo() {
  const [message, setMessage] = useState<string | null>(null)
  const info = {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    orientationAngle: window.screen.orientation?.angle ?? null,
    iosPermissionApi:
      'DeviceMotionEvent' in window &&
      typeof (window.DeviceMotionEvent as unknown as { requestPermission?: unknown })
        .requestPermission === 'function',
    vibrateSupported: 'vibrate' in navigator,
    wakeLockSupported: 'wakeLock' in navigator,
  }

  const copyInfo = async () => {
    const ok = await copyTextToClipboard(JSON.stringify(info, null, 2))
    setMessage(ok ? '기기 정보를 복사했어요.' : '복사에 실패했어요.')
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none font-bold">기기 정보</summary>
      <div className="mt-2 grid gap-2">
        <ul className="m-0 grid list-none gap-1 p-0 text-xs text-content-muted">
          <li className="break-all">UA: {info.userAgent}</li>
          <li>Secure context: {String(info.secureContext)}</li>
          <li>화면 방향: {info.orientationAngle ?? '알 수 없음'}°</li>
          <li>iOS 권한 API: {String(info.iosPermissionApi)}</li>
          <li>진동 지원: {String(info.vibrateSupported)}</li>
          <li>Wake Lock 지원: {String(info.wakeLockSupported)}</li>
        </ul>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={copyInfo}>
            기기 정보 복사
          </Button>
          {message && (
            <span className="text-xs text-content-muted" role="status" aria-live="polite">
              {message}
            </span>
          )}
        </div>
      </div>
    </details>
  )
}

const VIBRATE_PATTERN: Partial<Record<string, number | number[]>> = {
  shakeStarted: 40,
  shakeArmed: [30, 40, 30],
  throwDetected: 200,
}

function useFeedback(
  latestEventId: number | undefined,
  latestEventType: string | undefined,
  vibrateEnabled: boolean,
  setFlash: (flash: boolean) => void,
) {
  const seenRef = useRef<number | undefined>(latestEventId)
  useEffect(() => {
    if (latestEventId === undefined || latestEventId === seenRef.current) return
    seenRef.current = latestEventId
    if (latestEventType === undefined) return
    const pattern = VIBRATE_PATTERN[latestEventType]
    if (vibrateEnabled && pattern !== undefined) navigator.vibrate(pattern)
    if (latestEventType === 'throwDetected') {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 350)
      return () => clearTimeout(timer)
    }
  }, [latestEventId, latestEventType, vibrateEnabled, setFlash])
}

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let sentinel: WakeLockSentinel | null = null

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) await lock.release()
        else sentinel = lock
      } catch {}
    }
    void acquire()
    const handleVisibility = () => {
      if (!document.hidden) void acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      void sentinel?.release().catch(() => undefined)
    }
  }, [enabled])
}
