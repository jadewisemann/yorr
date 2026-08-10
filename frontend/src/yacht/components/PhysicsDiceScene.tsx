import { type PhysicsDiceSceneProps, usePhysicsDiceWorld } from '@/yacht/model/usePhysicsDiceWorld'
import { PhysicsDiceFallback } from './PhysicsDiceFallback'

export function PhysicsDiceScene(props: PhysicsDiceSceneProps) {
  const { dice, held, releaseRequestId, request, onHeldToggle, onRollComplete } = props
  const { containerRef, fallbackMessage, loading, resizing } = usePhysicsDiceWorld(props)

  if (fallbackMessage) {
    return (
      <PhysicsDiceFallback
        dice={dice}
        held={held}
        message={fallbackMessage}
        releaseRequestId={releaseRequestId}
        request={request}
        {...(onHeldToggle ? { onHeldToggle } : {})}
        onRollComplete={onRollComplete}
      />
    )
  }

  return (
    <section
      className="absolute inset-0 overflow-hidden"
      aria-label="사발과 KEEP 슬롯이 있는 3D 주사위 트레이"
    >
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-surface/75 text-content-muted backdrop-blur-sm"
          role="status"
        >
          <span className="grid justify-items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden="true"
              className="size-8 animate-spin-slow rounded-full border-3 border-border border-t-brand motion-reduce:animate-none"
            />
            3D 주사위 준비 중
          </span>
        </div>
      )}
      {resizing && (
        <div
          className="absolute inset-0 grid place-items-center bg-surface/75 font-mono text-xs text-content-muted backdrop-blur-sm"
          role="status"
        >
          3D 화면 크기를 조정하고 있어요.
        </div>
      )}
    </section>
  )
}
