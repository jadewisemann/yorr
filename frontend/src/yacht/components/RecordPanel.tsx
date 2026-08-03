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
  /** 전체 시트(점수표). open일 때만 보인다. */
  children: ReactNode
  onToggle: (open: boolean) => void
  open: boolean
  /** peek 상태에서도 보이는 퀵 기록 칩 스트립. */
  quick: ReactNode
  subtitle: string
  title: string
}

/** 이 거리 이상 끌면 열림/닫힘을 전환한다. */
const DRAG_TOGGLE_DISTANCE_PX = 56

/**
 * 디자인 Yacht Play Screens의 모바일 기록 패널.
 * 화면 아래 상시 고정 — 접힌(peek) 상태에선 손잡이·퀵 칩만 보이고,
 * 위로 밀어 올리면 전체 점수시트가 나온다. 모달이 아니라 뒤 화면 조작을 막지 않는다.
 */
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

  // 접힌 상태에선 패널 아무 데나 눌러도 열린다 — 드래그를 몰라도 막히지 않게.
  // 버튼(퀵 칩·토글)을 누른 경우는 그 동작이 우선이므로 건드리지 않는다.
  const handlePeekTap = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (open) return
    if (event.target instanceof Element && event.target.closest('button')) return
    onToggle(true)
  }

  // 열린 상태에선 손잡이 영역을 눌러 닫는다. 시트 본문 탭은 기록 조작이므로 건드리지 않는다.
  const handleHandleTap = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.target instanceof Element && event.target.closest('button')) return
    onToggle(false)
  }

  return (
    <>
      {/* 시트 밖을 누르면 닫힌다 — 일반적인 바텀시트 관례. 패널보다 먼저 그려 아래에 깔린다. */}
      {open && (
        <button
          aria-label="점수시트 닫기"
          className="fixed inset-0 z-sheet cursor-default border-0 bg-scrim p-0"
          onClick={() => onToggle(false)}
          // 포커스 표시가 없는 전체 화면 버튼이라 탭 순서에서 뺀다.
          // 키보드는 아래 토글 버튼으로 같은 동작을 한다.
          tabIndex={-1}
          type="button"
        />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 키보드·스크린리더는 아래 토글 버튼으로 같은 동작을 한다 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 위와 동일 — 이 탭은 포인터 사용자용 지름길이다 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-sheet flex h-[78%] flex-col rounded-t-sheet border-t border-white/14 bg-surface shadow-overlay transition-transform duration-(--ds-motion-base) ease-snappy',
          // peek: 손잡이(2.75rem) + 퀵 칩 영역(5.75rem)만 남기고 아래로 밀어둔다.
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
            className="mt-1.5 flex min-h-8 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2"
            onClick={() => onToggle(!open)}
            type="button"
          >
            <span className="text-[11px] font-semibold tracking-[0.05em] text-content">
              {title}
            </span>
            <span className="text-[11px] text-content-muted tabular-nums">{subtitle}</span>
            <span className="flex-1" />
            <span className="text-[11px] font-semibold text-brand-strong">
              {open ? '접기' : '전체 시트'}
            </span>
          </button>
        </div>

        <div className="flex-none border-b border-border pb-3">{quick}</div>

        {/* 펼친 상태에서 점수시트 마지막 줄(합계)이 홈 인디케이터 아래로 들어가지 않게 띄운다. */}
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
