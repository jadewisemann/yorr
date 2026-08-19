import { useState } from 'react'
import { DuelButton } from '@/duel/components/DuelButton'
import { MAX_FOULS, SWING_THRESHOLD } from '@/duel/domain/duel'
import { useSwing } from '@/shared/useSwing'

export function DuelHowTo() {
  const [practiced, setPracticed] = useState(false)
  const { permission, requestPermission } = useSwing({
    onSwing: () => setPracticed(true),
    threshold: SWING_THRESHOLD,
  })

  return (
    <div className="grid gap-2">
      <Step
        onPractice={() => setPracticed(true)}
        onRequest={() => void requestPermission()}
        permission={permission}
        practiced={practiced}
      />
      <p className="m-0 text-xs text-content-faint">
        신호 전에 뽑으면 부정출발 경고 · {MAX_FOULS}개가 차면 자기 발을 쏩니다
      </p>
    </div>
  )
}

function Step({
  onPractice,
  onRequest,
  permission,
  practiced,
}: {
  onPractice: () => void
  onRequest: () => void
  permission: ReturnType<typeof useSwing>['permission']
  practiced: boolean
}) {
  if (practiced) {
    return (
      <p className="m-0 text-sm font-bold text-brand" role="status">
        준비 완료 · 초록 불이 켜지면 방금처럼 뽑으세요
      </p>
    )
  }

  if (permission === 'denied' || permission === 'unsupported') {
    return (
      <>
        <p className="m-0 text-sm text-content-muted">
          모션 센서를 쓸 수 없어요. 게임에서는 화면을 눌러 뽑습니다.
        </p>
        <DuelButton onClick={onPractice} tone="neutral" variant="chip">
          눌러서 연습 뽑기
        </DuelButton>
      </>
    )
  }

  if (permission === 'granted') {
    return (
      <p className="m-0 text-sm text-content-muted" role="status">
        폰을 세로로 쥐고, 총을 뽑듯 <b className="text-content">아래로 확 내려 보세요</b>
      </p>
    )
  }

  return (
    <>
      <p className="m-0 text-sm text-content-muted">
        폰을 세로로 쥐고 휘둘러 뽑습니다. 먼저 센서를 켜 주세요.
      </p>
      <DuelButton onClick={onRequest} tone="brand" variant="chip">
        휴대폰 휘두르기 켜기
      </DuelButton>
    </>
  )
}
