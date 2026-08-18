import type { ReactNode } from 'react'
import { GameCanvas } from '@/shared/components/Screen'

export function ResultBackdrop({ children }: { children: ReactNode }) {
  return (
    <GameCanvas
      className="flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(#170817, #4a1622 58%, #0d0406)' }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-4 px-gutter">
        {children}
      </div>
    </GameCanvas>
  )
}
