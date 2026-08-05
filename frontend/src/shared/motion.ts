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

/** 스크림은 크기가 크므로 opacity만 움직인다. */
export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: ENTER },
  exit: { opacity: 0, transition: EXIT },
}
