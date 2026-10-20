/** 씬 코드가 공유하는 스칼라 헬퍼. */
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
