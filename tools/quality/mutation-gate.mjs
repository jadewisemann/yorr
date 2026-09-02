#!/usr/bin/env node
// 생존 돌연변이 게이트(QUALITY.md 5단계).
//
// stryker를 돌린 **그 잡 안에서** 돌린다. 리포트는 커밋되지 않으므로 PR 게이트에는
// 없고, 없는 것을 0으로 읽으면 게이트가 아니라 장식이 된다.

import { readMutationSummary } from './mutants.mjs'

const summary = readMutationSummary()
if (!summary) {
  console.error('돌연변이 리포트가 없다. npm run quality:mutation을 먼저 돌린다.')
  process.exit(2)
}

console.log(`생존 ${summary.survived} · 사멸 ${summary.killed} (파일 ${summary.files}개)`)
if (summary.survived > 0) {
  console.error('\n살아남은 돌연변이가 있다 — 그 변경을 잡는 검사가 없다는 뜻이다.')
  process.exit(1)
}
console.log('생존 돌연변이가 없다.')
