import { useState } from 'react'
import { useSwing } from '@/shared/useSwing'
import { MAX_FOULS, SWING_THRESHOLD } from './duel'

/**
 * 대기실 폰에 뜨는 석양 사용법. (S15P11A406-207)
 *
 * 205가 비워 둔 마지막 단계 슬롯에 꽂힌다 — 바깥은 이미 카드이므로 여기서는 내용만 그리고,
 * props를 받지 않는다(센서 상태는 자기 훅에서 직접 읽는다). 세로 공간을 대기실과 나눠 쓰므로
 * 한 번에 한 단계만 보여 준다.
 *
 * <b>연습을 시키는 이유.</b> 게임이 시작되면 신호는 1.4~4.6초 뒤 아무 예고 없이 초록이 된다.
 * 그때 처음 폰을 휘둘러 보면 감지 세기를 못 맞춰 첫 라운드를 통째로 날린다 — 여기서 한 번
 * 성공해 두면 팔이 그 세기를 기억한다. 그래서 연습은 게임과 <b>같은 임계값</b>을 쓴다.
 */
export function DuelHowTo() {
  const [practiced, setPracticed] = useState(false)
  // enabled를 걸지 않는 이유는 DuelGame과 같다 — 권한이 이미 허용된 폰(안드로이드)에서
  // 게이트를 열 버튼이 뜨지 않아 연습을 끝낼 방법이 사라진다.
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
      {/* 규칙은 단계와 상관없이 계속 보인다 — 연습에서 성급하게 뽑아 보는 사람이 있고,
          그게 게임에서 왜 경고인지 여기서 읽어야 한다. */}
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

  // 센서를 못 쓰는 폰은 화면 탭으로 뽑는다. 연습할 동작이 따로 없으니 한 번 눌러 보게만 한다.
  if (permission === 'denied' || permission === 'unsupported') {
    return (
      <>
        <p className="m-0 text-sm text-content-muted">
          모션 센서를 쓸 수 없어요. 게임에서는 화면을 눌러 뽑습니다.
        </p>
        <button
          className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-bold transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
          onClick={onPractice}
          type="button"
        >
          눌러서 연습 뽑기
        </button>
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
      <button
        className="min-h-11 rounded-full border border-brand/50 bg-brand/12 px-4 text-sm font-bold text-brand transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
        onClick={onRequest}
        type="button"
      >
        휴대폰 휘두르기 켜기
      </button>
    </>
  )
}
