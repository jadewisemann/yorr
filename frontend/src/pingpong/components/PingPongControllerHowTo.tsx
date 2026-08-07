import { useState } from 'react'
import { usesTouchFallback } from '@/pingpong/components/PingPongController/PreparationController'
import { Button } from '@/shared/components/Button'
import { useSwing } from '@/shared/useSwing'

type HowToStep = 'grip' | 'swing' | 'done'

export function PingPongControllerHowTo() {
  const [step, setStep] = useState<HowToStep>('grip')
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
