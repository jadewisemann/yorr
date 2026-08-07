import { useEffect, useState } from 'react'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { MOTION_GESTURE_CONFIG, type MotionGestureConfig } from '@/yacht/input/motionConfig'
import {
  clampParamValue,
  MOTION_PARAM_GROUPS,
  MOTION_PARAM_METAS,
  type MotionParamGroup,
  type MotionParamMeta,
} from './motionLabParams'

interface MotionLabParamsPanelProps {
  config: MotionGestureConfig
  onApply: (next: MotionGestureConfig) => void
}

const GROUP_ORDER: MotionParamGroup[] = ['shake', 'throw', 'timing']

export function MotionLabParamsPanel({ config, onApply }: MotionLabParamsPanelProps) {
  const setValue = (meta: MotionParamMeta, value: number) => {
    onApply({ ...config, [meta.key]: clampParamValue(meta, value) })
  }

  const changedCount = MOTION_PARAM_METAS.filter(
    (meta) => config[meta.key] !== MOTION_GESTURE_CONFIG[meta.key],
  ).length

  return (
    <section className="grid gap-4 rounded-panel border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-xl font-bold">판정 파라미터</h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={changedCount === 0}
          onClick={() => onApply({ ...MOTION_GESTURE_CONFIG })}
        >
          기본값 리셋{changedCount > 0 && ` (${changedCount})`}
        </Button>
      </div>
      <p className="m-0 text-sm text-content-muted">
        값을 바꾸면 인식기가 즉시 재생성되고 워밍업 캘리브레이션이 다시 돌아요. 변경값은 이
        브라우저에 자동 저장돼요.
      </p>
      {GROUP_ORDER.map((group) => (
        <details
          key={group}
          open={group === 'shake'}
          className="group rounded-card border border-border bg-surface-raised"
        >
          <summary className="cursor-pointer select-none px-4 py-3 font-bold">
            {MOTION_PARAM_GROUPS[group]} (
            {MOTION_PARAM_METAS.filter((meta) => meta.group === group).length})
          </summary>
          <div className="grid gap-5 border-t border-border p-4">
            {MOTION_PARAM_METAS.filter((meta) => meta.group === group).map((meta) => (
              <ParamRow
                key={meta.key}
                meta={meta}
                value={config[meta.key]}
                onValue={(value) => setValue(meta, value)}
              />
            ))}
          </div>
        </details>
      ))}
    </section>
  )
}

function ParamRow({
  meta,
  value,
  onValue,
}: {
  meta: MotionParamMeta
  value: number
  onValue: (value: number) => void
}) {
  const inputId = `motion-param-${meta.key}`
  const defaultValue = MOTION_GESTURE_CONFIG[meta.key]
  const isDefault = value === defaultValue
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commitDraft = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onValue(parsed)
    else setDraft(String(value))
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-bold text-content">
          {meta.label}
          {!isDefault && (
            <span className="ml-1 text-brand-strong">
              ●<span className="sr-only">기본값과 다름</span>
            </span>
          )}
        </label>
        <input
          type="number"
          inputMode="decimal"
          className={cn(
            'w-24 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm text-content',
            !isDefault && 'border-brand',
          )}
          aria-label={`${meta.label} 직접 입력`}
          min={meta.min}
          max={meta.max}
          step={meta.step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      </div>
      <input
        id={inputId}
        type="range"
        className="w-full accent-(--color-brand)"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(event) => onValue(Number(event.target.value))}
      />
      <p className="m-0 text-xs text-content-muted">
        {meta.description} · 기본 {defaultValue}
      </p>
    </div>
  )
}
