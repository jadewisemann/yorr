import { useEffect } from 'react'

let openCount = 0
let restoreOverflow = ''

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
      if (openCount > 0) return
      document.body.style.overflow = restoreOverflow
      background?.removeAttribute('inert')
    }
  }, [open])
}
