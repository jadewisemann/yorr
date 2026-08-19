/*
 * Popover 배치 계산 — 앵커 기준 위치·뷰포트 클램프·꼬리 좌표. 렌더와 무관한 순수
 * 산술이라 컴포넌트 밖에 둔다(원칙 7 "컴포넌트는 렌더링만").
 */

const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 10
const PANEL_WIDTH = 392
const MIN_PANEL_HEIGHT = 200
const PANEL_PADDING = 48
const TAIL_INSET = 20
export const TAIL_HALF = 7

export interface Placement {
  bottom: number | undefined
  flipped: boolean
  left: number
  maxContentHeight: number
  tailLeft: number
  top: number | undefined
  width: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function placeByAnchor(anchor: HTMLElement, preferredWidth = PANEL_WIDTH): Placement {
  const rect = anchor.getBoundingClientRect()
  const { innerHeight, innerWidth } = window
  const width = Math.min(preferredWidth, innerWidth - VIEWPORT_MARGIN * 2)
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    VIEWPORT_MARGIN,
    innerWidth - VIEWPORT_MARGIN - width,
  )
  const below = innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
  const above = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN
  const flipped = below < MIN_PANEL_HEIGHT && above > below

  return {
    bottom: flipped ? innerHeight - rect.top + ANCHOR_GAP : undefined,
    flipped,
    left,
    maxContentHeight: Math.max(flipped ? above : below, MIN_PANEL_HEIGHT) - PANEL_PADDING,
    tailLeft: clamp(rect.left + rect.width / 2 - left, TAIL_INSET, width - TAIL_INSET),
    top: flipped ? undefined : rect.bottom + ANCHOR_GAP,
    width,
  }
}
