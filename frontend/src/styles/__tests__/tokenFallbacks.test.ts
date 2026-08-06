import { describe, expect, it } from 'vitest'
import { DS_COLOR_FALLBACK } from '@/styles/tokenFallbacks'
// vite의 ?raw로 읽는다 — node:fs를 쓰면 @types/node를 tsconfig에 들여야 한다.
import tokens from '@/styles/tokens.css?raw'

/**
 * fallback은 CSS 변수를 못 읽었을 때만 쓰이므로 값이 낡아도 화면에서는 보이지 않는다.
 * 실제로 물리 주사위의 여섯 색이 옛 라임/네이비 테마 값 그대로 남아 있었다 — 「검지 않다」류의
 * 단정으로는 못 잡는다. 그래서 tokens.css 원본을 읽어 값 자체를 대조한다.
 */
describe('DS_COLOR_FALLBACK', () => {
  it('tokens.css에 선언된 값과 같다', () => {
    for (const [name, fallback] of Object.entries(DS_COLOR_FALLBACK)) {
      const declared = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim()
      expect(declared, `${name} 가 tokens.css 에 없다`).toBeDefined()
      expect(declared, name).toBe(fallback)
    }
  })

  it('렌더러가 쓰는 physics 색을 하나도 빠뜨리지 않는다', () => {
    const declared = [...tokens.matchAll(/--ds-color-physics-[\w-]+(?=:)/g)].map(
      (match) => match[0],
    )
    expect(new Set(declared)).toEqual(new Set(Object.keys(DS_COLOR_FALLBACK)))
  })
})
