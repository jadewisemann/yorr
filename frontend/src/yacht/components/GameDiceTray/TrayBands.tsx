import { Button } from '@/shared/components/Button'
import { IconShake } from '@/shared/components/Icon'
import { Tooltip } from '@/shared/components/Tooltip'
import { RollCounter } from '@/yacht/components/RollCounter'

/**
 * 트레이 위쪽 띠 — 남은 굴리기와 흔들기 입구. 밴드 자신은 클릭을 통과시키고, 실제로 눌러야
 * 하는 칩·툴팁 트리거만 pointer-events를 되살린다(트레이 탭 = 굴리기이므로).
 */
export function TrayTopBand({
  coachOpen,
  onOpenMotionPanel,
  settledRollCount,
  showMotionChip,
}: {
  coachOpen: boolean
  onOpenMotionPanel: () => void
  settledRollCount: number
  showMotionChip: boolean
}) {
  return (
    <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex items-center gap-1.5">
      {/* 흔들기 안내로 들어가는 조용한 입구. 알럿과 달리 아무것도 막지 않고 기다린다. */}
      {showMotionChip && (
        <button
          className="pointer-events-auto flex cursor-pointer items-center gap-1 rounded-full border border-border bg-surface/80 px-2 py-1 text-2xs font-bold tracking-[0.06em] text-content-muted uppercase transition-colors hover:text-content focus-ring focus-visible:outline-offset-2"
          data-tutorial="motion"
          onClick={onOpenMotionPanel}
          type="button"
        >
          <IconShake className="size-3.5" />
          흔들기
        </button>
      )}
      <RollCounter rollsUsed={settledRollCount} />
      <Tooltip
        align="end"
        className="pointer-events-auto text-content-faint"
        content="턴마다 최대 3번 굴릴 수 있어요. 주사위 눈이 남은 횟수예요."
        label="남은 굴리기 설명"
        spotlight={coachOpen}
      />
    </div>
  )
}

/** 트레이 아래쪽 띠 — 킵 레일 라벨(좌)과 안내문(가운데)을 같은 grid에 둔다. */
export function TrayBottomBand({
  coachOpen,
  keptText,
  statusText,
  wide,
}: {
  coachOpen: boolean
  keptText: string
  statusText: string
  wide: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-2.5 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
      {/* 주사위를 탭할 때마다 숫자가 바뀐다 — tabular-nums가 없으면 라벨 폭이 흔들려
          옆에 붙은 툴팁 트리거까지 함께 밀린다. */}
      <span className="flex items-center gap-1.5 text-2xs font-bold tracking-[0.13em] text-content-faint tabular-nums uppercase">
        킵 레일 · {keptText}
        <Tooltip
          align="start"
          className="pointer-events-auto"
          content="주사위를 탭하면 킵돼서 여기 줄지어요. 킵한 주사위는 다시 굴리지 않고, 한 번 더 탭하면 풀려요."
          label="킵 레일 설명"
          side="top"
          spotlight={coachOpen}
        />
      </span>
      {/* 안내문은 와이드에서만 — 모바일은 기록 패널이 안내를 겸한다.
          빈 자리를 <span/>으로 메우지 않는다. 트랙 셋(1fr auto 1fr)과 gap은 grid가
          이미 잡고 있어, 항목이 없어도 가운데 칸은 그대로 선다. */}
      {wide && (
        <p className="m-0 text-center text-sm/none whitespace-nowrap text-content-muted">
          {statusText}
        </p>
      )}
    </div>
  )
}

/**
 * 첫 진입 안내(S15P11A406-143). 주사위 판만 덮고 툴팁이 얹힌 상·하단 밴드는 남겨,
 * 링이 켜진 ⓘ 두 개가 어두운 배경 위에서 저절로 눈에 띄게 한다.
 *
 * z는 토큰(sticky 10 …) 아래의 5·6을 직접 쓴다 — 트레이 안에서 "밴드(z-10)보다 아래"만
 * 뜻하는 국소 값이라, 앱 전역 레이어 스케일에 새 단을 만들 일이 아니다.
 */
export function TooltipCoachmark({ onDone }: { onDone: () => void }) {
  return (
    <>
      <button
        aria-label="안내 닫기"
        className="absolute inset-0 z-[5] cursor-pointer border-0 bg-black/65"
        onClick={onDone}
        type="button"
      />
      <div className="absolute inset-x-6 top-1/2 z-[6] grid -translate-y-1/2 gap-2.5 rounded-card border border-border-strong bg-surface-raised/95 p-3.5 shadow-raised">
        <p aria-live="polite" className="m-0 text-xs leading-relaxed text-content">
          지금 빛나는 동그라미 두 개를 눌러 보세요. 굴리기 횟수와 킵 레일 설명이 그 자리에서 나와요.
        </p>
        <p className="m-0 text-xs leading-relaxed text-content-muted">
          요트다이스가 처음이라면 헤더의 도움말에서 <strong>튜토리얼 모드</strong>를 켜 보세요.
        </p>
        <Button onClick={onDone} size="sm" variant="secondary">
          알겠어요
        </Button>
      </div>
    </>
  )
}
