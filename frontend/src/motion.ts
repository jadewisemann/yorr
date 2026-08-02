import type { Transition, Variants } from 'motion/react'

/**
 * 모션 토큰. 값은 styles/tokens.css의 `--ds-motion-*`·`--ds-ease-snappy`와 짝을 맞춘다 —
 * CSS는 장식 keyframe을, 여기 값은 JS가 그리는 진입·퇴장·제스처를 담당한다.
 *
 * 기준(ui-skills/animation-systems): 마이크로 120–200ms · UI 상태 180–260ms ·
 * 팝오버·토스트 220–320ms · 섹션 진입 400–800ms. transform·opacity만 움직인다.
 */
export const DURATION = {
  /** 눌림·호버 같은 즉각 피드백. --ds-motion-fast와 같은 값. */
  fast: 0.12,
  /** 시트·모달·전환. --ds-motion-base와 같은 값. */
  base: 0.22,
  /** 화면 전환처럼 거리가 있는 이동. */
  page: 0.28,
} as const

/** --ds-ease-snappy와 같은 곡선. 들어올 때는 ease-out으로 부드럽게 정착시킨다. */
export const EASE_SNAPPY = [0.2, 0, 0, 1] as const
/** 나갈 때는 더 빠르게 뺀다 — 사용자는 이미 다음 화면을 보고 싶어 한다. */
export const EASE_EXIT = [0.4, 0, 1, 1] as const

export const ENTER: Transition = { duration: DURATION.base, ease: EASE_SNAPPY }
export const EXIT: Transition = { duration: DURATION.fast, ease: EASE_EXIT }

/** 바텀시트 — 아래에서 올라온다. 거리는 %라 시트 높이가 달라져도 같은 느낌을 준다. */
export const sheetVariants: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: ENTER },
  exit: { y: '100%', transition: EXIT },
}

/** 모달·팝오버 — 제자리에서 살짝 커지며 뜬다(scale + fade). */
export const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: ENTER },
  exit: { opacity: 0, scale: 0.97, transition: EXIT },
}

/**
 * 화면 전환 — 새 화면이 오른쪽에서 밀려 들어온다(앱의 push와 같은 방향).
 * <p>
 * 퇴장 변형이 없는 것은 의도다. 나가는 화면을 붙잡아 두면 그 안의 `<Outlet/>`이 이미 바뀐
 * 라우터 상태를 다시 읽어 새 화면을 그린다 — 새 화면이 사라졌다 나타나는 깜빡임이 된다.
 * 자세한 이유는 `app/router.tsx`의 `ScreenTransition`에 있다.
 * <p>
 * 시작 불투명도가 0이 아닌 것도 같은 이유다 — 0에서 시작하면 첫 프레임이 빈 화면이다.
 * 거리를 24px로 짧게 두는 이유는 두 가지다. 화면 전체를 크게 밀면 `h-svh overflow-hidden`
 * 안의 3D 트레이가 전환 내내 화면 밖으로 나갔다 들어오고, transform이 걸린 조상은
 * `position: fixed` 자식의 기준이 되므로 다이얼로그가 함께 흔들린다.
 */
export const pageVariants: Variants = {
  hidden: { opacity: 0.4, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.page, ease: EASE_SNAPPY } },
}

/** 스크림은 크기가 크므로 opacity만 움직인다. */
export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: ENTER },
  exit: { opacity: 0, transition: EXIT },
}
