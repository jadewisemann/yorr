/**
 * Flyway 스크립트 이름·버전 규약 — ADR-0005.
 *
 * `V<version>__<description>.sql`. 버전의 `_`는 `.`과 같은 구분자이고
 * (`V2_1__x.sql` = 2.1), description의 `_`는 공백이 된다. 이 두 값이 그대로
 * `flyway_schema_history`의 `version`·`description` 컬럼에 들어가므로 운영 DB의
 * 기존 행과 문자 단위로 같아야 "이미 적용됨"으로 이어진다.
 */

/** `V1__create_user_tables.sql` 같은 versioned 마이그레이션 이름. */
const VERSIONED_SCRIPT = /^V(\d+(?:[._]\d+)*)__(.+)\.sql$/

export interface ParsedScriptName {
  /** `.`으로 정규화한 버전 문자열. history 테이블에 그대로 들어간다. */
  readonly version: string
  /** `_`를 공백으로 바꾼 설명. */
  readonly description: string
  /** 파일명 원문(`script` 컬럼 값). */
  readonly script: string
}

/**
 * versioned 마이그레이션 파일명을 파싱한다. 규약에 맞지 않으면 `undefined` —
 * repeatable(`R__`)·README 등은 조용히 무시된다(우리는 repeatable을 쓰지 않는다).
 */
export const parseScriptName = (filename: string): ParsedScriptName | undefined => {
  const match = VERSIONED_SCRIPT.exec(filename)
  if (!match) return undefined
  const [, rawVersion, rawDescription] = match
  if (rawVersion === undefined || rawDescription === undefined) return undefined
  return {
    version: rawVersion.replaceAll('_', '.'),
    description: rawDescription.replaceAll('_', ' '),
    script: filename,
  }
}

const parts = (version: string): number[] =>
  version.split('.').map((part) => Number.parseInt(part, 10))

/**
 * Flyway의 버전 비교. 숫자 단위로 앞에서부터 비교하고, 없는 자리는 0으로 본다 —
 * `1.0`과 `1`은 **같은 버전**이다(정규화 규칙도 여기서 나온다).
 */
export const compareVersions = (left: string, right: string): number => {
  const a = parts(left)
  const b = parts(right)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/** 이력 행과 파일을 맞대 볼 때 쓰는 비교용 키(뒤따르는 0을 떼어낸다). */
export const normalizeVersion = (version: string): string => {
  const trimmed = parts(version)
  while (trimmed.length > 1 && trimmed.at(-1) === 0) trimmed.pop()
  return trimmed.join('.')
}
