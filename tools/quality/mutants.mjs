import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Stryker의 JSON 리포트에서 살아남은 돌연변이를 센다. 커버리지가 아예 없는
 * 자리(NoCoverage)도 "테스트가 잡지 못한다"는 점에서 생존과 같이 다룬다.
 *
 * 리포트가 없으면 `null`을 돌려준다 — **측정하지 않은 것과 0은 다르다.** 이 구분이
 * 없으면 stryker를 돌리지 않은 자리에서 게이트가 저절로 통과한다.
 */
export function readMutationSummary(path = join(HERE, '.stryker.json')) {
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  const files = report.files ?? {}
  const mutants = Object.values(files).flatMap((file) => file.mutants ?? [])
  const count = (status) => mutants.filter((mutant) => mutant.status === status).length
  return {
    survived: count('Survived') + count('NoCoverage'),
    killed: count('Killed'),
    files: Object.keys(files).length,
  }
}
