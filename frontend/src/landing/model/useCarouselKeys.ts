import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 캐러셀의 좌우 키 이동. 입력·텍스트 필드·모달 안에서는 양보한다 — 화면 어딘가에
 * 포커스가 있어도 커서 이동이 우선이다.
 */
export function useCarouselKeys(step: (delta: number) => void) {
  const stepRef = useRef(step)
  useLayoutEffect(() => {
    stepRef.current = step
  })

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const delta = keyboardStep(event)
      if (delta === 0) return
      event.preventDefault()
      stepRef.current(delta)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

function keyboardStep(event: globalThis.KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return 0
  const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) return 0
  const target = event.target as HTMLElement | null
  const guarded = target?.closest('input, textarea, select, [contenteditable], [aria-modal="true"]')
  return guarded ? 0 : delta
}
