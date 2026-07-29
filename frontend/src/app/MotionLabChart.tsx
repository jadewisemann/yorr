import { type RefObject, useEffect, useRef } from 'react'
import type { LabChartSample } from './useMotionLab'

interface MotionLabChartProps {
  bufferRef: RefObject<LabChartSample[]>
  field: 'horizontal' | 'forward'
  label: string
  /** 굵은 기준선 (shakePeak / throwPeak) — 양 필드 모두 effective 값 기준 */
  threshold: number
  /** 히스테리시스 해제선 (horizontal 전용) */
  releaseThreshold?: number
  /** 임계선을 ±양쪽에 그릴지 (horizontal은 양방향 판정) */
  symmetric?: boolean
}

const WINDOW_MS = 4_000
const HEIGHT = 110

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** 최근 4초 파형을 rAF로 직접 그리는 스트립 차트. React 상태를 거치지 않아 50Hz에도 조용하다. */
export function MotionLabChart({
  bufferRef,
  field,
  label,
  threshold,
  releaseThreshold,
  symmetric = false,
}: MotionLabChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const waveColor = cssColor('--color-brand', '#38bdf8')
    const thresholdColor = cssColor('--color-danger', '#f87171')
    const releaseColor = cssColor('--color-positive', '#fbbf24')
    const gridColor = 'rgba(148, 163, 184, 0.35)'
    const textColor = cssColor('--color-content-muted', 'rgba(148, 163, 184, 0.9)')

    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (width === 0) return
      if (canvas.width !== width * ratio || canvas.height !== HEIGHT * ratio) {
        canvas.width = width * ratio
        canvas.height = HEIGHT * ratio
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, HEIGHT)

      const buffer = bufferRef.current ?? []
      const latestAt = buffer.at(-1)?.at ?? 0
      const peak = buffer.reduce((max, entry) => Math.max(max, Math.abs(entry[field])), 0)
      const scale = Math.max(threshold * 1.4, peak * 1.1, 5)
      const midY = HEIGHT / 2
      const toY = (value: number) => midY - (value / scale) * (HEIGHT / 2 - 4)
      const toX = (at: number) => width - ((latestAt - at) / WINDOW_MS) * width

      context.strokeStyle = gridColor
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(0, midY)
      context.lineTo(width, midY)
      context.stroke()

      const drawGuide = (value: number, color: string) => {
        context.strokeStyle = color
        context.setLineDash([5, 4])
        context.beginPath()
        context.moveTo(0, toY(value))
        context.lineTo(width, toY(value))
        if (symmetric) {
          context.moveTo(0, toY(-value))
          context.lineTo(width, toY(-value))
        }
        context.stroke()
        context.setLineDash([])
      }
      drawGuide(threshold, thresholdColor)
      if (releaseThreshold !== undefined) drawGuide(releaseThreshold, releaseColor)

      if (buffer.length > 1) {
        context.strokeStyle = waveColor
        context.lineWidth = 2
        context.beginPath()
        buffer.forEach((entry, index) => {
          const x = toX(entry.at)
          const y = toY(entry[field])
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        })
        context.stroke()
      }

      context.fillStyle = textColor
      context.font = '11px sans-serif'
      context.fillText(`±${scale.toFixed(1)} m/s²`, 6, 13)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [bufferRef, field, threshold, releaseThreshold, symmetric])

  return (
    <figure className="m-0 grid gap-1">
      <figcaption className="text-sm font-bold text-content">{label}</figcaption>
      <canvas
        ref={canvasRef}
        className="w-full rounded-card border border-border bg-surface-sunken"
        style={{ height: HEIGHT }}
        aria-label={`${label} 파형 차트`}
      />
    </figure>
  )
}
