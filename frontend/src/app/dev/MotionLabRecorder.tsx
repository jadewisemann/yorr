import { useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from '@/yacht/input/motionConfig'
import { copyTextToClipboard } from './motionLabClipboard'
import {
  type MotionRecording,
  parseRecording,
  type ReplayResult,
  replayRecording,
  serializeRecording,
} from './motionLabReplay'

interface MotionLabRecorderProps {
  canRecord: boolean
  isRecording: boolean
  onStartRecording: () => void
  onStopRecording: () => void
  recording: MotionRecording | null
  onLoadRecording: (recording: MotionRecording) => void
  config: MotionGestureConfig
}

interface ComparedReplay {
  withDefaults: ReplayResult
  withCurrent: ReplayResult
}

export function MotionLabRecorder({
  canRecord,
  isRecording,
  onStartRecording,
  onStopRecording,
  recording,
  onLoadRecording,
  config,
}: MotionLabRecorderProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [compared, setCompared] = useState<ComparedReplay | null>(null)

  const runReplay = () => {
    if (!recording) return
    setCompared({
      withDefaults: replayRecording(recording, MOTION_GESTURE_CONFIG),
      withCurrent: replayRecording(recording, config),
    })
  }

  const copyRecording = async () => {
    if (!recording) return
    const ok = await copyTextToClipboard(serializeRecording(recording))
    setMessage(ok ? '녹화 JSON을 복사했어요.' : '복사에 실패했어요. 다운로드를 이용해 주세요.')
  }

  const downloadRecording = () => {
    if (!recording) return
    const blob = new Blob([serializeRecording(recording)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `motion-recording-${recording.recordedAt.replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importRecording = () => {
    try {
      onLoadRecording(parseRecording(importText))
      setImportText('')
      setImportOpen(false)
      setCompared(null)
      setMessage('녹화를 불러왔어요. 리플레이를 실행해 보세요.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '녹화를 읽지 못했어요.')
    }
  }

  return (
    <section className="grid gap-3 rounded-panel border border-border bg-surface p-5">
      <h2 className="m-0 text-xl font-bold">녹화 · 리플레이</h2>
      <p className="m-0 text-sm text-content-muted">
        원시 센서 스트림을 녹화해 두면(최대 30초) 파라미터를 바꿔가며 같은 동작을 결정적으로
        재판정할 수 있어요. JSON으로 내보내면 데스크톱에서도 그대로 재현돼요.
      </p>
      <div className="flex flex-wrap gap-2">
        {isRecording ? (
          <Button size="sm" onClick={onStopRecording}>
            ■ 녹화 정지
          </Button>
        ) : (
          <Button size="sm" disabled={!canRecord} onClick={onStartRecording}>
            ● 녹화 시작
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={!recording} onClick={runReplay}>
          ▷ 리플레이 실행
        </Button>
        <Button size="sm" variant="secondary" disabled={!recording} onClick={copyRecording}>
          JSON 복사
        </Button>
        <Button size="sm" variant="secondary" disabled={!recording} onClick={downloadRecording}>
          다운로드
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setImportOpen((open) => !open)}>
          가져오기
        </Button>
      </div>
      {!canRecord && !recording && (
        <p className="m-0 text-xs text-content-faint">
          녹화는 센서 수신 중일 때만 가능해요. 가져오기로 기존 녹화를 불러올 수는 있어요.
        </p>
      )}
      {recording && (
        <p className="m-0 text-xs text-content-muted">
          불러온 녹화: 샘플 {recording.samples.length.toLocaleString()}개 ·{' '}
          {(recording.samples.at(-1)?.t ?? 0) / 1_000}초 · {recording.recordedAt || '시각 미상'}
        </p>
      )}
      {importOpen && (
        <div className="grid gap-2">
          <label htmlFor="motion-recording-import" className="text-sm font-bold">
            녹화 JSON 붙여넣기
          </label>
          <textarea
            id="motion-recording-import"
            className="min-h-24 w-full rounded-card border border-border bg-surface-sunken p-2 font-mono text-xs text-content"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='{"type":"yorr-motion-recording", …}'
          />
          <Button size="sm" disabled={importText.trim() === ''} onClick={importRecording}>
            불러오기
          </Button>
        </div>
      )}
      {message && (
        <p className="m-0 text-sm text-content-muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {compared && (
        <div className="grid gap-2 md:grid-cols-2">
          <ReplayColumn title="기본 config" result={compared.withDefaults} />
          <ReplayColumn title="현재 config" result={compared.withCurrent} highlight />
        </div>
      )}
    </section>
  )
}

function ReplayColumn({
  title,
  result,
  highlight = false,
}: {
  title: string
  result: ReplayResult
  highlight?: boolean
}) {
  const majorEvents = result.events.filter((event) => event.type !== 'shakePulse')
  const throwCount = result.events.filter((event) => event.type === 'throwDetected').length
  return (
    <div
      className={cn(
        'grid content-start gap-1.5 rounded-card border p-3',
        highlight ? 'border-brand' : 'border-border',
      )}
    >
      <h3 className="m-0 text-sm font-bold">
        {title}
        <span className={cn('ml-2', throwCount > 0 ? 'text-brand-strong' : 'text-content-faint')}>
          던지기 {throwCount}회
        </span>
      </h3>
      {majorEvents.length === 0 ? (
        <p className="m-0 text-xs text-content-faint">주요 이벤트 없음</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0 text-xs">
          {majorEvents.map((event) => (
            <li
              key={`${event.type}-${event.at}`}
              className={cn(
                'flex justify-between gap-2 tabular-nums',
                event.type === 'throwDetected'
                  ? 'font-bold text-brand-strong'
                  : 'text-content-muted',
              )}
            >
              <span>{event.type}</span>
              <span>{(event.at / 1_000).toFixed(2)}s</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-xs text-content-faint">
        shakePulse {result.events.length - majorEvents.length}회 생략
      </p>
    </div>
  )
}
