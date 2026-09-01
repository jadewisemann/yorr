/** 3D 장면이 공유하는 보간·클램프. 도메인 계산(`domain/court.ts`)과 달리 순전히 표현용이다. */

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
