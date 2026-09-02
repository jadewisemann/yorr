import type { PhysicsDiceRollRequest, PhysicsDiceSet } from '@/yacht/rendering/physics-dice/types'

/**
 * 물리 주사위 장면의 대역. jsdom에는 WebGL이 없고, 이 화면 스위트가 보는 것은 주사위가
 * 어떻게 굴러가는지가 아니라 화면이 서버 메시지에 어떻게 반응하는지다. 그래서 굴림
 * 완료·킵 토글을 버튼 두 개로 대신하고 전달받은 값은 data 속성으로 드러낸다.
 *
 * 별도 모듈인 이유: `vi.mock`은 그것을 부른 **테스트 파일**에만 걸리므로 하네스에
 * 둘 수 없다. 검사 파일마다 한 줄로 이 모듈을 끼운다.
 */
export const PhysicsDiceScene = ({
  motionFollow,
  motionPulse,
  onHeldToggle,
  onRollComplete,
  releaseRequestId,
  request,
}: {
  motionFollow?: boolean
  motionPulse?: { direction: 'left' | 'right'; id: number; strength: number } | null
  onHeldToggle?: (index: 0) => void
  onRollComplete: (requestId: string, dice: PhysicsDiceSet) => void
  releaseRequestId: string | null
  request: PhysicsDiceRollRequest | null
}) => (
  <div
    data-follow={motionFollow ? 'on' : 'off'}
    data-pulse={motionPulse ? `${motionPulse.direction}:${motionPulse.strength}` : ''}
    data-release={releaseRequestId ?? ''}
    data-request={request?.requestId ?? ''}
    data-target={request?.targetDice.join(',') ?? ''}
    data-testid="dice-scene"
  >
    {request && (
      <button onClick={() => onRollComplete(request.requestId, request.targetDice)} type="button">
        굴림 완료
      </button>
    )}
    <button onClick={() => onHeldToggle?.(0)} type="button">
      첫 주사위 킵
    </button>
  </div>
)
