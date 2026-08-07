import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useId,
  useRef,
  useState,
} from 'react'
import { cn } from '@/shared/cn'

interface RecordPanelProps {
  children: ReactNode
  onToggle: (open: boolean) => void
  open: boolean
  quick: ReactNode
  subtitle: string
  title: string
}

const DRAG_TOGGLE_DISTANCE_PX = 56

export function RecordPanel({
  children,
  onToggle,
  open,
  quick,
  subtitle,
  title,
}: RecordPanelProps) {
  const sheetId = useId()
  const dragStartRef = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return
    setDragOffset(event.clientY - dragStartRef.current)
  }
  const handlePointerUp = () => {
    if (dragStartRef.current === null) return
    const offset = dragOffset
    dragStartRef.current = null
    setDragOffset(0)
    if (open && offset > DRAG_TOGGLE_DISTANCE_PX) onToggle(false)
    if (!open && offset < -DRAG_TOGGLE_DISTANCE_PX) onToggle(true)
  }

  const handlePeekTap = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (open) return
    if (event.target instanceof Element && event.target.closest('button')) return
    onToggle(true)
  }

  const handleHandleTap = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.target instanceof Element && event.target.closest('button')) return
    onToggle(false)
  }

  return (
    <>
      {open && (
        <button
          aria-label="점수시트 닫기"
          className="fixed inset-0 z-sheet cursor-default border-0 bg-scrim p-0"
          onClick={() => onToggle(false)}
          tabIndex={-1}
          type="button"
        />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 키보드·스크린리더는 아래 토글 버튼으로 같은 동작을 한다 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 위와 동일 — 이 탭은 포인터 사용자용 지름길이다 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-sheet flex h-[78%] flex-col rounded-t-sheet border-t border-border-raised bg-surface shadow-overlay transition-transform duration-(--ds-motion-base) ease-snappy',
          open ? 'translate-y-0' : 'translate-y-[calc(100%-8.5rem)] cursor-pointer',
        )}
        onClick={handlePeekTap}
        style={
          dragOffset !== 0 ? { transform: `translateY(${Math.max(0, dragOffset)}px)` } : undefined
        }
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 키보드·스크린리더는 아래 토글 버튼으로 같은 동작을 한다 */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 위와 동일 — 이 탭은 포인터 사용자용 지름길이다 */}
        <div
          className={cn(
            'flex-none touch-none px-4 pt-2 pb-1.5',
            open ? 'cursor-pointer' : 'cursor-grab',
          )}
          data-tutorial="sheet-handle"
          onClick={handleHandleTap}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <span aria-hidden="true" className="mx-auto block h-1 w-11 rounded-full bg-white/24" />
          <button
            aria-controls={sheetId}
            aria-expanded={open}
            className="mt-1.5 flex min-h-8 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left focus-ring focus-visible:outline-offset-2"
            onClick={() => onToggle(!open)}
            type="button"
          >
            <span className="text-2xs font-semibold tracking-[0.05em] text-content">{title}</span>
            <span className="text-2xs text-content-muted tabular-nums">{subtitle}</span>
            <span className="flex-1" />
            <span className="text-2xs font-semibold text-brand-strong">
              {open ? '접기' : '전체 시트'}
            </span>
          </button>
        </div>

        <div className="flex-none border-b border-border pb-3">{quick}</div>

        <div
          className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]"
          id={sheetId}
        >
          {children}
        </div>
      </div>
    </>
  )
}
