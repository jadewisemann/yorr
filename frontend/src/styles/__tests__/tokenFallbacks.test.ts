import { describe, expect, it } from 'vitest'
import { DS_COLOR_FALLBACK } from '@/styles/tokenFallbacks'
import tokens from '@/styles/tokens.css?raw'

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
