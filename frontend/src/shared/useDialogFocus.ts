import { useEffect, useEffectEvent } from 'react'

interface DialogFocusOptions {
  /** 열릴 때 처음 포커스를 받을 요소를 고른다. `selector`를 넘겼으면 그 값을 받는다. */
  initialFocus: (selector: string | undefined) => HTMLElement | null | undefined
  /** 열려 있는 동안 document의 keydown을 받는다(Escape·Tab 가두기). */
  onKeyDown: (event: KeyboardEvent) => void
  /** 첫 포커스를 고르는 선택자. 바뀌면 열린 채로 첫 포커스를 다시 잡는다. */
  selector?: string | undefined
}

/**
 * Modal·Popover·BottomSheet가 함께 쓰는 열림 포커스 수명 — 열리면 첫 요소로 포커스를
 * 옮기고 keydown을 듣다가, 닫히면 열기 전 포커스로 되돌린다.
 *
 * 두 콜백은 effect event라 부모가 새 onClose를 넘겨도 효과가 다시 돌지 않는다 —
 * 다시 돌면 사용자가 옮겨 둔 포커스를 첫 요소가 도로 빼앗는다.
 */
export function useDialogFocus(
  open: boolean,
  { initialFocus, onKeyDown, selector }: DialogFocusOptions,
) {
  const pickInitial = useEffectEvent(initialFocus)
  const handleKeyDown = useEffectEvent(onKeyDown)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    pickInitial(selector)?.focus()

    const onDocumentKeyDown = (event: KeyboardEvent) => handleKeyDown(event)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown)
      previousFocus?.focus()
    }
  }, [open, selector])
}
