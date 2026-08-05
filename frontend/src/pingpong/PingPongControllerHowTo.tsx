import { useState } from 'react'
import { Button } from '@/shared/components/Button'
import { useSwing } from '@/shared/useSwing'
import { usesTouchFallback } from './PingPongController'

/**
 * 대기실 연결 시퀀스 마지막 단계에 꽂히는 탁구 사용법. (S15P11A406-206)
 *
 * 게임이 시작되기 <b>전</b>에 여기서 끝내야 하는 일이 두 개다:
 *
 * 1. <b>모션 권한.</b> iOS는 `DeviceMotionEvent.requestPermission()`을 사용자 탭 안에서만
 *    받는다. 게임이 시작된 뒤에 물으면 첫 서브가 오는 동안 권한 팝업을 읽게 된다 —
 *    대기실은 아무 일도 일어나지 않는 유일한 시간이라 여기가 그 자리다.
 * 2. <b>센서가 실제로 잡히는지.</b> 권한이 granted라도 기기가 값을 안 주는 경우가 있다.
 *    한 번 휘둘러 보게 해서 안 잡히면 그 자리에서 탭 조작으로 안내한다.
 *
 * 서버에는 아무것도 보내지 않는다. 이 시점의 방은 `waiting`이라 `game.ping_pong.swing`을
 * 받을 상대가 없다 — 연습 스윙은 게임이 시작된 뒤 워밍업(`PingPongPreparationController`)이
 * 맡고, 여기는 손이 기억할 동작과 권한까지만 준비한다.
 */
type HowToStep = 'grip' | 'swing' | 'done'

export function PingPongControllerHowTo() {
  const [step, setStep] = useState<HowToStep>('grip')
  // 잡는 법을 읽는 동안의 스윙은 세지 않는다 — 폰을 고쳐 쥐는 동작도 임계값을 넘긴다.
  const { permission, requestPermission } = useSwing({
    enabled: step === 'swing',
    onSwing: () => setStep('done'),
  })
  const tapOnly = usesTouchFallback(permission)

  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <strong className="text-sm font-bold text-content">{title(step, tapOnly)}</strong>

      {step === 'grip' && (
        <>
          <p className="m-0 text-sm text-content-muted">
            화면이 위를 보게 세워 잡고, 손목만 꺾지 말고 팔로 짧게 휘두릅니다.
          </p>
          {/* 권한 요청은 반드시 이 탭 안에서 부른다 — 단계 전환과 같은 핸들러여야 iOS가 받는다. */}
          <Button
            onClick={() => {
              setStep('swing')
              void requestPermission()
            }}
            size="sm"
            type="button"
          >
            스윙 연습하기
          </Button>
        </>
      )}

      {step === 'swing' &&
        (tapOnly ? (
          <>
            <p className="m-0 text-sm text-warning">
              모션 센서를 쓸 수 없어요. 화면을 눌러 받아치는 조작으로 진행합니다.
            </p>
            <Button onClick={() => setStep('done')} size="sm" type="button" variant="secondary">
              화면을 눌러 스윙
            </Button>
          </>
        ) : (
          <p className="m-0 text-sm text-content-muted" role="status">
            폰을 라켓처럼 휘두르면 감지돼요. 세게 휘두르지 않아도 됩니다.
          </p>
        ))}

      {step === 'done' && (
        <p className="m-0 text-sm text-content-muted" role="status">
          방장이 시작하면 연습 공을 한 번 치고 준비 완료를 누르면 경기가 시작돼요.
        </p>
      )}
    </div>
  )
}

function title(step: HowToStep, tapOnly: boolean) {
  if (step === 'grip') return '폰을 라켓처럼 쥐세요'
  if (step === 'swing') return '한 번 휘둘러 보세요'
  return tapOnly ? '탭 조작으로 준비됐어요' : '스윙 감지 완료'
}
