import type { ReactNode } from 'react'

export function ResultBackdrop({ children }: { children: ReactNode }) {
  return (
    <main
      className="relative flex h-svh w-full flex-col items-center justify-center overflow-hidden text-white"
      style={{ background: 'linear-gradient(#170817, #4a1622 58%, #0d0406)' }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-5 px-gutter">
        {children}
      </div>
    </main>
  )
}
