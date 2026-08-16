import type { ComponentProps } from 'react'
import { cn } from '@/shared/cn'

/*
 * 블록 알림. "지금 이 화면에서 알아야 할 한 문장"을 담는 자리다.
 *
 * 왜 필요했나: 같은 모양이 호출부마다 알파를 달리 적고 있었다 — 위험 톤 하나가
 * `border-brand/36` · `/30` · `/50` 세 값으로 갈렸다. 눈대중 알파는
 * design-system.md가 금지하는 "사다리에 없는 단"이고, 세 곳을 각자 고치면
 * 다음에 또 갈린다.
 *
 * 알약 배지(`PlayerCard`의 대기 표시 등)는 여기 넣지 않는다 — 모양도 역할도 다르다.
 * 그건 Badge의 몫이다.
 */

const tones = {
  /* 위험·오류. 시스템 레드를 옅게 깔고 글자만 danger로 든다. */
  danger: 'border-brand/36 bg-brand/8 text-danger',
  /* 그냥 안내. 캔버스에서 한 단 뜬 면으로만 구분한다. */
  neutral: 'border-border bg-surface text-content-muted',
  /* 완료·성공. */
  positive: 'border-positive/40 bg-positive/10 text-positive',
} as const

/*
 * 스크린리더 역할은 톤이 정한다 — 호출부 52곳이 각자 기억할 것이 아니다.
 * neutral은 비워둔다: 화면에 처음부터 있는 설명문이라 live region이 아니다.
 * 톤과 다르게 읽혀야 하면 호출부가 `role`을 넘겨 덮는다.
 */
const roles = {
  danger: 'alert',
  neutral: undefined,
  positive: 'status',
} as const

type AlertProps = ComponentProps<'div'> & {
  tone?: keyof typeof tones
}

export function Alert({ className, tone = 'neutral', role, ...props }: AlertProps) {
  return (
    <div
      className={cn('rounded-card border px-3.5 py-3 text-sm', tones[tone], className)}
      role={role ?? roles[tone]}
      {...props}
    />
  )
}
