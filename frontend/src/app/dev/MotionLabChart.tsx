import { type RefObject, useEffect, useRef } from 'react'
import type { LabChartSample } from './useMotionLab'

interface MotionLabChartProps {
  bufferRef: RefObject<LabChartSample[]>
  field: 'horizontal' | 'forward'
  label: string
  threshold: number
  releaseThreshold?: number
  symmetric?: boolean
}

const WINDOW_MS = 4_000
const HEIGHT = 110

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, ratio: number) {
  const expectedWidth = width * ratio
  const expectedHeight = HEIGHT * ratio
  if (canvas.width === expectedWidth && canvas.height === expectedHeight) return
  canvas.width = expectedWidth
  canvas.height = expectedHeight
}

function drawGuide(
  context: CanvasRenderingContext2D,
  toY: (value: number) => number,
  value: number,
  color: string,
  symmetric: boolean,
) {
  context.strokeStyle = color
  context.setLineDash([5, 4])
  context.beginPath()
  context.moveTo(0, toY(value))
  context.lineTo(context.canvas.clientWidth, toY(value))
  if (symmetric) {
    context.moveTo(0, toY(-value))
    context.lineTo(context.canvas.clientWidth, toY(-value))
  }
  context.stroke()
  context.setLineDash([])
}

function drawWave(
  context: CanvasRenderingContext2D,
  buffer: LabChartSample[],
  field: MotionLabChartProps['field'],
  toX: (at: number) => number,
  toY: (value: number) => number,
  color: string,
) {
  if (buffer.length <= 1) return
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  buffer.forEach((entry, index) => {
    const point = [toX(entry.at), toY(entry[field])] as const
    if (index === 0) context.moveTo(...point)
    else context.lineTo(...point)
  })
  context.stroke()
}

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
      resizeCanvas(canvas, width, ratio)
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

      drawGuide(context, toY, threshold, thresholdColor, symmetric)
      if (releaseThreshold !== undefined) {
        drawGuide(context, toY, releaseThreshold, releaseColor, symmetric)
      }
      drawWave(context, buffer, field, toX, toY, waveColor)

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
