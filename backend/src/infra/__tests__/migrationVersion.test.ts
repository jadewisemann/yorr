import { describe, expect, it } from 'vitest'
import { compareVersions, normalizeVersion, parseScriptName } from '../migrations/version.js'

describe('parseScriptName', () => {
  it('Flyway 파일명을 version·description으로 가른다', () => {
    expect(parseScriptName('V1__create_user_tables.sql')).toEqual({
      version: '1',
      description: 'create user tables',
      script: 'V1__create_user_tables.sql',
    })
    expect(parseScriptName('V2__create_match_tables.sql')).toEqual({
      version: '2',
      description: 'create match tables',
      script: 'V2__create_match_tables.sql',
    })
  })

  it('버전의 `_`는 `.`과 같은 구분자다 (V2_1 = 2.1)', () => {
    expect(parseScriptName('V2_1__add_email.sql')?.version).toBe('2.1')
    expect(parseScriptName('V10.3__x.sql')?.version).toBe('10.3')
  })

  it('versioned가 아닌 파일은 무시한다', () => {
    expect(parseScriptName('R__refresh_view.sql')).toBeUndefined()
    expect(parseScriptName('README.md')).toBeUndefined()
    expect(parseScriptName('V1_create_user_tables.sql')).toBeUndefined() // 구분자가 `__`가 아니다
    expect(parseScriptName('Vx__nope.sql')).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('문자열이 아니라 숫자로 비교한다', () => {
    expect(compareVersions('2', '10')).toBe(-1)
    expect(compareVersions('10', '2')).toBe(1)
    expect(compareVersions('1.2', '1.10')).toBe(-1)
  })

  it('없는 자리는 0이라 1과 1.0은 같은 버전이다', () => {
    expect(compareVersions('1', '1.0')).toBe(0)
    expect(compareVersions('1.0.0', '1')).toBe(0)
    expect(compareVersions('1.0.1', '1')).toBe(1)
  })

  it('정렬에 그대로 쓸 수 있다', () => {
    expect(['10', '2', '1.1', '1'].sort(compareVersions)).toEqual(['1', '1.1', '2', '10'])
  })
})

describe('normalizeVersion', () => {
  it('이력 행과 파일을 맞대는 키에서 뒤따르는 0을 떼어낸다', () => {
    expect(normalizeVersion('1.0')).toBe('1')
    expect(normalizeVersion('1.0.0')).toBe('1')
    expect(normalizeVersion('1.10')).toBe('1.10')
    expect(normalizeVersion('0')).toBe('0')
  })
})
