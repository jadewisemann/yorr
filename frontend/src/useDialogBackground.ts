import { useEffect } from 'react'

/**
 * 시트 위에 모달이 겹쳐 열린다(족보 시트 → 0점 확정). 먼저 닫히는 쪽이 배경을
 * 되살리면 남은 다이얼로그의 뒤 화면이 다시 열리므로 열린 개수를 센다.
 */
let openCount = 0
let restoreOverflow = ''

/**
 * 다이얼로그가 열려 있는 동안 뒤 화면을 무력화한다 — 스크롤 잠금 + `inert`.
 *
 * `aria-modal="true"`만으로는 부족하다. 스크린리더가 브라우즈 모드에서 뒤 화면으로
 * 그냥 넘어가는 경우가 많고, 시트 뒤 배경은 터치로 스크롤된다.
 */
export function useDialogBackground(open: boolean) {
  useEffect(() => {
    if (!open) return

    const background = document.querySelector('main')
    if (openCount === 0) {
      restoreOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      background?.setAttribute('inert', '')
    }
    openCount += 1

    return () => {
      openCount -= 1
      // 마지막 다이얼로그가 닫힐 때만 되돌린다.
      if (openCount > 0) return
      document.body.style.overflow = restoreOverflow
      background?.removeAttribute('inert')
    }
  }, [open])
}
