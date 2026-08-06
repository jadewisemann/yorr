/**
 * CSS 변수를 못 읽었을 때 쓰는 값 — **[`tokens.css`](tokens.css)와 같은 값을 양쪽에 적어 둔 것**이다.
 *
 * three.js·canvas 렌더러는 CSS 변수를 직접 못 쓴다. `getComputedStyle`로 읽되 아직 스타일이
 * 붙기 전이면 빈 문자열이 나오므로 fallback이 필요하고, 그 fallback은 **틀려도 화면에 안 보인다** —
 * 변수 해석이 실패하는 순간에만 드러나기 때문이다. 실제로 물리 주사위의 여섯 색이 옛 라임/네이비
 * 테마 값 그대로 남아 있었다. 그래서 값을 한곳에 모으고 `__tests__/tokenFallbacks.test.ts`가
 * `tokens.css`와 대조한다.
 *
 * `styles/`에 두는 이유: `yacht/rendering/`은 비공개 세그먼트라 `landing/rendering/`이 가져올 수
 * 없다. 토큰 값 자체는 어느 도메인의 것도 아니므로 토큰 정의 옆이 제자리다.
 */
export const DS_COLOR_FALLBACK = {
  '--ds-color-physics-accent': '#ff4d48',
  '--ds-color-physics-danger': '#e53935',
  '--ds-color-physics-die': '#f4f1e8',
  '--ds-color-physics-pip': '#0b0b0c',
  '--ds-color-physics-rail': '#0d0e10',
  '--ds-color-physics-slot': 'rgb(255 255 255 / 14%)',
} as const

export type DsColorName = keyof typeof DS_COLOR_FALLBACK

/** 한 색만 필요할 때. 여러 색을 한 번에 읽을 때는 {@link dsColorReader}를 쓴다. */
export function dsColor(name: DsColorName): string {
  return dsColorReader()(name)
}

/** `getComputedStyle`을 한 번만 부르고 여러 색을 읽는다. */
export function dsColorReader(): (name: DsColorName) => string {
  const styles = getComputedStyle(document.documentElement)
  return (name) => styles.getPropertyValue(name).trim() || DS_COLOR_FALLBACK[name]
}
