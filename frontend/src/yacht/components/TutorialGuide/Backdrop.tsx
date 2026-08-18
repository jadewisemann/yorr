import { cn } from '@/shared/cn'
import type { SpotlightRect } from '@/yacht/components/TutorialGuide/types'

export function Backdrop({ dim, spotlight }: { dim: boolean; spotlight: SpotlightRect | null }) {
  if (!spotlight) {
    return <div className="pointer-events-auto absolute inset-0 bg-scrim-strong" />
  }

  const top = spotlight.top - 6
  const left = spotlight.left - 6
  const right = spotlight.left + spotlight.width + 6
  const bottom = spotlight.top + spotlight.height + 6
  const block = cn('pointer-events-auto absolute', dim && 'bg-scrim-strong')

  return (
    <>
      <div className={block} style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className={block} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div
        className={block}
        style={{ top, height: bottom - top, left: 0, width: Math.max(0, left) }}
      />
      <div className={block} style={{ top, height: bottom - top, left: right, right: 0 }} />
      <div
        className="pointer-events-none absolute rounded-panel ring-3 ring-brand-strong motion-safe:animate-tutorial-halo"
        style={{ top, left, width: spotlight.width + 12, height: spotlight.height + 12 }}
      />
    </>
  )
}
