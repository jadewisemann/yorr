import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge는 Tailwind 기본 테마만 안다. styles/tokens.css의 `@theme`으로 추가한
 * 키(tap·card·panel 등)는 등록하지 않으면 "모르는 class"로 취급돼 충돌 그룹에 들어가지
 * 못하고, 컴포넌트 기본값과 호출자 override가 둘 다 살아남는다. 그러면 승자를 cn()이
 * 아니라 빌드된 CSS 선언 순서가 정한다 — "외부 배치는 className으로 확장한다"는
 * 디자인 시스템 규칙이 성립하지 않는다.
 *
 * 아래 목록은 tokens.css의 `@theme inline` 블록과 짝을 맞춘다. 토큰을 추가·삭제하면
 * 여기도 같이 고친다. 색 토큰은 tailwind-merge의 색 validator가 임의 이름을 받아주므로
 * 등록하지 않아도 병합된다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ['tap', 'content', 'landing', 'play', 'gutter'],
      radius: ['control', 'card', 'panel', 'sheet'],
      shadow: [
        'raised',
        'overlay',
        'cta',
        'landing-panel',
        'landing-card',
        'landing-card-quiet',
        'landing-card-inset',
        'landing-popover',
        'landing-cta',
        'landing-cta-sheet',
      ],
      text: ['display'],
      'font-weight': ['landing-medium', 'landing-bold'],
      ease: ['snappy'],
      animate: [
        'spin-slow',
        'dice-roll',
        'ring-pulse',
        'turn-pop',
        'turn-flash',
        'callout-pop',
        'callout-flash',
        'callout-burst',
        'guide-bob',
        'caret-blink',
      ],
    },
    // z-index는 tailwind-merge의 theme 키가 아니라 class 그룹으로 등록한다.
    // duration은 등록하지 않는다 — Tailwind v4에 `--duration-*` 네임스페이스가 없어
    // 이름 있는 duration class 자체가 존재할 수 없다(tokens.css의 같은 주석 참고).
    classGroups: {
      z: [{ z: ['sticky', 'banner', 'sheet', 'modal', 'toast'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
