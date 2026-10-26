// `tools/check-code-quality.mjs`의 스캐너 자체를 시험한다.
//
// 왜 필요한가: 이 게이트는 파서가 아니라 토큰 스캐너라서, 정규식을 조금 손대면
// 조용히 **아무것도 못 잡는** 상태가 될 수 있다. 초록만 보고는 그것을 알 수 없다
// (TESTING.md 규칙 1 — 일부러 심어 빨개지는지 본다). 여기서는 스크립트를
// 임시 저장소에서 실제로 돌려 exit code를 본다.
//
// 사용: `npm run test:quality` (루트)
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

const SCRIPT = resolve(import.meta.dirname, 'check-code-quality.mjs')

/** 이 스크립트가 읽는 최소 저장소: `backend/src`·`frontend/src` + git. */
const withRepo = (files, run) => {
  const root = mkdtempSync(join(tmpdir(), 'yorr-quality-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    execFileSync('git', ['add', '-A'], { cwd: root })
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** exit code와 출력을 함께 돌려준다. 위반 목록·기준선 안내는 **stderr**로 나간다. */
const run = (root, args = []) => {
  // spawnSync는 실패해도 던지지 않는다 — exit code를 그대로 본다.
  const result = spawnSync('node', [SCRIPT, ...args], { cwd: root, encoding: 'utf8' })
  return { code: result.status ?? 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const branchy = (count) =>
  Array.from({ length: count }, (_, index) => `  if (x === ${index}) out += '${index}'`).join('\n')

describe('check-code-quality', () => {
  it('깨끗한 코드는 통과한다', () => {
    const result = withRepo(
      {
        'backend/src/clean.ts': 'export const add = (a: number, b: number): number => a + b\n',
      },
      (root) => run(root, ['--write-baseline']),
    ).output
    assert.match(result, /기준선을 다시 썼다/)
  })

  it('사이클로매틱 복잡도 초과를 잡는다', () => {
    const source = `export const branchy = (x: number): string => {\n  let out = ''\n${branchy(25)}\n  return out\n}\n`
    const { code, output } = withRepo({ 'backend/src/branchy.ts': source }, (root) => run(root))
    assert.equal(code, 1)
    assert.match(output, /cyclomatic/)
    assert.match(output, /branchy/)
  })

  it('중첩 깊이 초과를 잡는다', () => {
    const nested = `export const deep = (x: number): number => {
  let total = 0
  if (x) { if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { total += 1 } } } } } }
  return total
}
`
    const { code, output } = withRepo({ 'backend/src/deep.ts': nested }, (root) => run(root))
    assert.equal(code, 1)
    assert.match(output, /nesting/)
  })

  it('죽은 export를 잡는다', () => {
    const { code, output } = withRepo(
      { 'backend/src/orphan.ts': 'export const neverUsed = (): number => 1\n' },
      (root) => run(root),
    )
    assert.equal(code, 1)
    assert.match(output, /deadExports/)
    assert.match(output, /neverUsed/)
  })

  it('테스트가 쓰는 export는 죽었다고 하지 않는다', () => {
    const result = withRepo(
      {
        'backend/src/used.ts': 'export const usedByTest = (): number => 1\n',
        'backend/src/__tests__/used.test.ts':
          "import { usedByTest } from '../used.js'\nvoid usedByTest()\n",
      },
      (root) => run(root),
    )
    assert.equal(result.code, 0)
  })

  it('인터페이스의 메서드 시그니처를 함수로 세지 않는다', () => {
    // 이 오탐이 있으면 `info(payload): void` 같은 한 줄이 "함수"로 잡혀 기준선을 오염시킨다.
    const source = `export interface Logger {
  info(payload: unknown, message?: string): void
  warn(payload: unknown): void
}
`
    const result = withRepo({ 'backend/src/logger.ts': source }, (root) => {
      run(root, ['--write-baseline'])
      return run(root)
    })
    assert.equal(result.code, 0)
  })

  it('함수가 아닌 키워드 블록을 함수로 세지 않는다', () => {
    const source = `export const pick = (x: number): string => {
  switch (x) {
    case 1:
      return 'a'
    default:
      return 'b'
  }
}
`
    const result = withRepo({ 'backend/src/pick.ts': source }, (root) => {
      run(root, ['--write-baseline'])
      return run(root)
    })
    assert.equal(result.code, 0)
  })

  it('파일 간 40줄 중복 블록을 한 번만 보고한다', () => {
    const body = Array.from(
      { length: 40 },
      (_, index) => `  const value${index} = value${Math.max(0, index - 1)} + ${index}`,
    ).join('\n')
    const block = (name) => `export const ${name} = (value0: number): number => {\n${body}\n  return value39\n}\n`
    const { code, output } = withRepo(
      { 'backend/src/a.ts': block('a'), 'backend/src/b.ts': block('b') },
      (root) => run(root),
    )
    assert.equal(code, 1)
    assert.match(output, /duplicateBlocks/)
    // 창이 한 줄씩 밀리며 같은 블록에 여러 번 걸린다 — 보고는 한 번이어야 한다.
    assert.match(output, /duplicateBlocks \(1건/)
  })

  it('기준선에 있던 위반은 통과시킨다', () => {
    const source = `export const branchy = (x: number): string => {\n  let out = ''\n${branchy(25)}\n  return out\n}\n`
    const result = withRepo({ 'backend/src/branchy.ts': source }, (root) => {
      run(root, ['--write-baseline'])
      return run(root)
    })
    assert.equal(result.code, 0)
  })

  it('기준선 갱신은 늘어난 위반을 알린다', () => {
    const source = `export const branchy = (x: number): string => {\n  let out = ''\n${branchy(25)}\n  return out\n}\n`
    const { output } = withRepo({ 'backend/src/branchy.ts': source }, (root) =>
      run(root, ['--write-baseline']),
    )
    assert.match(output, /새로 들어온 위반/)
  })
})
