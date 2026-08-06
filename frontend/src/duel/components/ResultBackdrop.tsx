import type { ReactNode } from 'react'

/**
 * 석양이 진다 — 1:1 반응속도 대결.
 *
 * 신호등이 초록으로 바뀌는 순간 먼저 뽑은 쪽이 쏜다. 1ms까지 같으면 TIE고, 3발 맞으면
 * 쓰러진다. 신호 전에 뽑으면 경고가 쌓이고 두 개가 차면 자기 발을 쏜다(규칙은 서버 소유).
 *
 * 이 화면은 판정을 하지 않는다. 뽑은 순간의 반응 시간만 서버에 올리고, 서버가 내려준
 * 상태를 무대(Arena)가 이해하는 "지금 이 화면"으로 번역한다. 진영 번호는 서버가 주지
 * 않으므로 여기서 <b>나를 항상 왼쪽</b>에 두고 좌우를 매긴다.
 */

/**
 * 결과 화면의 바탕.
 *
 * 석양 그라디언트를 <b>화면 전체</b>에 칠하고, 폭 제한은 안쪽 내용에만 준다. 예전에는 main
 * 하나에 `max-w-2xl`과 배경을 같이 걸어서, 큰 화면(TV·모니터)에서 가운데 672px만 석양이고
 * 양옆이 검게 남아 화면이 잘린 것처럼 보였다.
 */
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
