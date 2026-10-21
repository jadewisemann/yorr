// `qualityScanner.mjs`의 순수 함수 시험 — 게이트가 재는 값 자체를 고정한다.
//
// 스크립트 전체를 돌리는 `check-code-quality.test.mjs`는 "무엇을 막는가"를 보고,
// 여기서는 **숫자를 세는 방식**을 본다. 계산이 조용히 틀리면 게이트는 아무것도
// 잡지 못하면서 초록을 낸다.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cyclomaticOf,
  functionsOf,
  halsteadOf,
  nestingOf,
  stripNonCode,
  typeBodyRanges,
} from './qualityScanner.mjs'

describe('stripNonCode', () => {
  it('주석을 지우고 줄 수는 보존한다', () => {
    const text = 'const a = 1 // 주석\n/* 여러\n줄 */\nconst b = 2\n'
    const stripped = stripNonCode(text)
    assert.equal(stripped.split('\n').length, text.split('\n').length)
    assert.ok(!stripped.includes('주석'))
    assert.ok(stripped.includes('const a = 1'))
    assert.ok(stripped.includes('const b = 2'))
  })

  it('문자열 안의 주석 기호는 코드로 오해하지 않는다', () => {
    const stripped = stripNonCode('const url = "http://x" // real comment\n')
    assert.ok(!stripped.includes('real comment'))
    assert.ok(stripped.includes('const url'))
  })

  it('템플릿 리터럴을 지운다', () => {
    const stripped = stripNonCode('const s = `a ${b} c`\nconst after = 1\n')
    assert.ok(!stripped.includes('a ${b} c'))
    assert.ok(stripped.includes('const after = 1'))
  })
})

describe('typeBodyRanges', () => {
  it('인터페이스 본문 범위를 찾는다', () => {
    const code = 'export interface A {\n  x: number\n}\nconst after = 1\n'
    const ranges = typeBodyRanges(code)
    assert.equal(ranges.length, 1)
    assert.ok(ranges[0].start < ranges[0].end)
  })

  it('타입 별칭의 객체 리터럴도 포함한다', () => {
    const code = 'type A = {\n  x: number\n}\n'
    assert.equal(typeBodyRanges(code).length, 1)
  })
})

describe('functionsOf', () => {
  it('선언·화살표·클래스 메서드를 모두 찾는다', () => {
    const code = `export function declared(a: number): number {
  return a
}

export const arrow = (a: number): number => {
  return a
}

export class Box {
  method(a: number): number {
    return a
  }
}
`
    const names = functionsOf(code).map((entry) => entry.name).sort()
    assert.deepEqual(names, ['arrow', 'declared', 'method'])
  })

  it('인터페이스 메서드 시그니처는 세지 않는다', () => {
    const code = 'export interface L {\n  info(payload: unknown): void\n}\n'
    assert.deepEqual(functionsOf(code), [])
  })

  it('switch·catch 같은 키워드 블록은 세지 않는다', () => {
    const code = `export const pick = (x: number): string => {
  switch (x) {
    default:
      return 'a'
  }
}
`
    const names = functionsOf(code).map((entry) => entry.name)
    assert.deepEqual(names, ['pick'])
  })

  it('한 줄짜리 목업은 세지 않는다', () => {
    assert.deepEqual(functionsOf('export const noop = (): void => {}\n'), [])
  })

  it('매개변수 수를 센다(구조 분해는 하나)', () => {
    const code = `export const f = (a: number, b: number, { c }: { c: number }): number => {
  return a + b + c
}
`
    const [entry] = functionsOf(code)
    assert.equal(entry.parameters, 3)
  })

  it('매개변수가 없으면 0이다', () => {
    const code = 'export const f = (): number => {\n  return 1\n}\n'
    assert.equal(functionsOf(code)[0].parameters, 0)
  })
})

describe('cyclomaticOf', () => {
  it('분기가 없으면 1이다', () => {
    assert.equal(cyclomaticOf('return a + b'), 1)
  })

  it('if·논리 연산자·삼항·배열 메서드 호출을 센다', () => {
    // 1 + if + && + ?: + map = 5
    assert.equal(cyclomaticOf('if (a && b) return a ? b : c.map((x) => x)'), 5)
  })

  it('??와 ?.도 분기다', () => {
    assert.equal(cyclomaticOf('a ?? b.c?.d'), 3)
  })
})

describe('nestingOf', () => {
  it('중괄호 깊이의 최대값이다', () => {
    assert.equal(nestingOf('{ a { b { c } } }'), 3)
    assert.equal(nestingOf('if (a) { if (b) { x } }'), 2)
  })

  it('평평하면 0이다', () => {
    assert.equal(nestingOf('a + b'), 0)
  })
})

describe('halsteadOf', () => {
  it('연산자나 피연산자가 없으면 0이다', () => {
    assert.equal(halsteadOf(''), 0)
    assert.equal(halsteadOf('&& ||'), 0)
  })

  it('연산자가 다양할수록 난이도가 높다', () => {
    const simple = halsteadOf('const a = b + c')
    const varied = halsteadOf('if (a && b) { return a ? b : c }')
    assert.ok(varied > simple, `${varied} > ${simple}`)
  })

  it('양수이고 유한하다', () => {
    const value = halsteadOf('const x = 1 + 2 * 3')
    assert.ok(Number.isFinite(value))
    assert.ok(value > 0)
  })
})
