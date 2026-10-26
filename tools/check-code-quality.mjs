#!/usr/bin/env node
// 코드 품질 지표를 **결정론적으로** 재는 게이트 (QUALITY.md 4절의 자체 분석기).
//
// Biome이 못 재는 것만 담당한다. 인지 복잡도는 Biome의 `noExcessiveCognitiveComplexity`
// 가 정본이고(CI가 error/22로 강제), 여기서 근사로 다시 재면 두 숫자가 갈려 어느 쪽을
// 믿어야 할지 알 수 없게 된다.
//
//   1. 사이클로매틱 복잡도  (함수별, <= 22)  — Biome에 이 규칙이 없다
//   2. 할스테드 난이도      (파일별, <= 80)  — 토큰 수준 근사
//   3. 함수 길이            (함수별, <= 80줄)
//   4. 매개변수 수          (함수별, <= 5)
//   5. 중첩 깊이            (함수별, <= 4)
//   6. 중복 코드            (파일 간, 40줄 동일 블록)
//   7. 죽은 export          (어디서도 참조되지 않는 export)
//
// 스캐너(토큰 수준)는 `qualityScanner.mjs`에 있다 — 순수 함수라 따로 시험한다.
//
// 사용:
//   node tools/check-code-quality.mjs                # 검사(신규 위반이면 exit 1)
//   node tools/check-code-quality.mjs --report       # 수치만 출력
//   node tools/check-code-quality.mjs --write-baseline   # 기준선 갱신(리뷰 대상)
//
// 예외는 `tools/quality-baseline.json`에 **파일+규칙+이름**으로 고정한다. 값이 아니라
// 존재를 고정하므로 같은 자리가 더 나빠져도 통과하지만 새 자리는 막힌다.
// `--write-baseline`은 늘어난 위반을 나열한다 — PR diff가 리뷰 자리다.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  cyclomaticOf,
  functionsOf,
  halsteadOf,
  nestingOf,
  stripNonCode,
  typeBodyRanges,
} from './qualityScanner.mjs'

const BASELINE_PATH = 'tools/quality-baseline.json'
const PACKAGES = ['backend', 'frontend']

/** QUALITY.md 4절의 상한. */
export const LIMITS = {
  cyclomatic: 22,
  halsteadDifficulty: 80,
  functionLines: 80,
  parameters: 5,
  nesting: 4,
  duplicateLines: 40,
}

const args = process.argv.slice(2)
const MODE = args.includes('--write-baseline')
  ? 'write'
  : args.includes('--report')
    ? 'report'
    : 'check'

// ─────────────────────────────────────────────────────────────── 소스 수집
const git = (gitArgs) =>
  execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/**
 * 테스트·생성물·**개발용 화면**은 대상이 아니다.
 *
 * - 테스트·생성물: TESTING.md·QUALITY.md 3절 (b)와 같은 이유.
 * - `app/dev/*`: 프로덕션 번들에 들어가지 않고(`router.tsx`가 dev 전용 라우트로만
 *   참조) 커버리지 측정에서도 빠져 있다. 카탈로그·모션랩 같은 화면은 **일부러**
 *   한 파일에 조작 패널과 미리보기를 모은 것이라, 함수 길이 기준을 들이대면
 *   "실험 도구를 읽기 좋게 유지하라"는 요구가 아니라 쪼개라는 요구가 된다.
 *   대신 이 파일들은 커버리지·번들 크기 어느 쪽으로도 출하물에 영향을 주지 않는다.
 */
const isProduction = (file) =>
  /\.(ts|tsx)$/.test(file) &&
  !/(^|\/)(__tests__|test|e2e)\//.test(file) &&
  !/\.(test|spec|stories)\.(ts|tsx)$/.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !/(^|\/)(dist|coverage|node_modules)\//.test(file) &&
  !/(^|\/)src\/app\/dev\//.test(file)

// 추적 중인 파일 + 아직 add하지 않은 새 파일을 **모두** 본다. `ls-files`만 쓰면
// 작업 중인 새 파일이 게이트를 통째로 빠져나가고, 커밋 훅에서야 처음 걸린다
// (그때는 기준선을 이미 쓴 뒤라 "새 위반"으로 보인다).
const ALL_SOURCES = git([
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
  ...PACKAGES.map((pkg) => `${pkg}/src`),
])
  .split('\0')
  .filter(Boolean)
const files = ALL_SOURCES.filter(isProduction)

// 코드 사본은 **모든 소스**(테스트 포함)에 만든다 — 죽은 export 판정은 테스트도
// 소비자로 세야 하고, 측정 자체는 `files`(비테스트)만 본다.
const CODE = new Map()
const RAW = new Map()
for (const file of ALL_SOURCES) {
  const raw = readFileSync(file, 'utf8')
  RAW.set(file, raw)
  CODE.set(file, stripNonCode(raw))
}

// ─────────────────────────────────────────── 중복·죽은 export (파일 간)
/** 공백·주석을 지운 줄이 N줄 연속 같으면 중복으로 본다. */
const duplicateBlocks = () => {
  const WINDOW = LIMITS.duplicateLines
  const index = new Map()
  const hits = []
  for (const file of files) {
    const lines = CODE.get(file)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== '{' && line !== '}')
    let windowStart = -1
    for (let at = 0; at + WINDOW <= lines.length; at += 1) {
      const key = lines.slice(at, at + WINDOW).join('\n')
      // 짧은 줄만 모인 창은 우연히 겹친다 — 정보량이 낮으면 버린다.
      if (key.replace(/\s/g, '').length < WINDOW * 8) continue
      const previous = index.get(key)
      if (previous === undefined) {
        index.set(key, file)
        windowStart = -1
        continue
      }
      if (previous === file) continue
      // 같은 블록은 창이 한 줄씩 밀리며 여러 번 걸린다 — 한 번만 보고한다.
      if (windowStart === -1) {
        hits.push({ a: previous, b: file })
        windowStart = at
      }
    }
  }
  return hits
}

/**
 * export는 있는데 어디서도 참조하지 않는 심볼. **테스트도 소비자로 센다** —
 * 테스트가 쓰는 export를 죽었다고 하면 게이트가 거짓말을 한다. 진입점(`main.ts`)과
 * 배럴(`index.ts`)은 재수출이 목적이라 면제한다.
 */
const deadExports = () => {
  // 코드만 남긴 사본으로 센다 — 주석에 이름이 나온다고 살아 있는 것은 아니다.
  const corpus = [...CODE.entries()]
  const rawCorpus = [...RAW.entries()]
  const entryLike = /(^|\/)(main|index)\.(ts|tsx)$/
  const exported = []
  for (const file of files) {
    if (entryLike.test(file)) continue
    const code = CODE.get(file)
    const pattern =
      /export\s+(?:async\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
    let match
    while ((match = pattern.exec(code)) !== null) exported.push({ file, name: match[1] })
  }

  const dead = []
  for (const { file, name } of exported) {
    const word = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`)
    const quoted = new RegExp(`['"]${name}['"]`)
    let used = false
    for (const [other, code] of corpus) {
      if (other !== file && word.test(code)) {
        used = true
        break
      }
    }
    // 동적 임포트는 심볼 이름을 **문자열**로 부른다(`lazyRouteComponent(..., 'DevCatalog')`).
    // 문자열은 CODE에서 지워졌으므로 원본에서 따로 본다.
    if (!used) {
      for (const [other, raw] of rawCorpus) {
        if (other !== file && quoted.test(raw)) {
          used = true
          break
        }
      }
    }
    if (used) continue
    // 같은 파일에서만 쓰는 export도 내보낼 이유가 없다.
    const own = CODE.get(file).match(new RegExp(word.source, 'g')) ?? []
    if (own.length <= 1) dead.push({ file, name })
  }
  return dead
}

// ───────────────────────────────────────────────────── 검사 실행
const violations = []
const stats = { halsteadDifficulty: 0, duplicateBlocks: 0, deadExports: 0 }

const functions = files.flatMap((file) => {
  const code = CODE.get(file)
  return functionsOf(code, typeBodyRanges(code)).map((entry) => ({ ...entry, file, code }))
})

for (const entry of functions) {
  const body = entry.code.slice(entry.body.start, entry.body.end + 1)
  const checks = [
    ['cyclomatic', cyclomaticOf(body)],
    ['functionLines', entry.endLine - entry.startLine + 1],
    ['parameters', entry.parameters],
    ['nesting', nestingOf(body)],
  ]
  for (const [rule, value] of checks) {
    if (value > LIMITS[rule]) {
      violations.push({ rule, value, file: entry.file, line: entry.startLine, name: entry.name })
    }
  }
}

for (const file of files) {
  const value = halsteadOf(CODE.get(file))
  stats.halsteadDifficulty = Math.max(stats.halsteadDifficulty, value)
  if (value > LIMITS.halsteadDifficulty) {
    violations.push({
      rule: 'halsteadDifficulty',
      value: Math.round(value),
      file,
      line: 1,
      name: '-',
    })
  }
}

const duplicates = duplicateBlocks()
for (const hit of duplicates) {
  violations.push({ rule: 'duplicateBlocks', value: LIMITS.duplicateLines, file: hit.b, line: 1, name: `= ${hit.a}` })
}

const dead = deadExports()
for (const entry of dead) {
  violations.push({ rule: 'deadExports', value: 1, file: entry.file, line: 1, name: entry.name })
}

stats.duplicateBlocks = duplicates.length
stats.deadExports = dead.length

// ───────────────────────────────────────────────────── 기준선 장부
const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {}
/** 위반 하나의 안정적인 키 — 파일 + 규칙 + 이름. 값이 아니라 "존재"를 고정한다. */
const keyOf = (violation) => `${violation.file}\u0000${violation.rule}\u0000${violation.name}`
const known = new Set(Object.keys(baseline.violations ?? {}))

if (MODE === 'write') {
  const next = {}
  for (const violation of violations) next[keyOf(violation)] = violation.value
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ limits: LIMITS, violations: sorted }, null, 2)}\n`)

  // 이 명령은 기준선을 올릴 수 있다 — 그래서 올라간 값을 반드시 말해 준다.
  const added = Object.keys(next).filter((key) => !known.has(key))
  const removed = [...known].filter((key) => next[key] === undefined)
  console.error(`기준선을 다시 썼다: 위반 ${Object.keys(next).length}건.`)
  if (added.length > 0) console.error(`새로 들어온 위반: ${added.length}건 (리뷰에서 확인하라)`)
  for (const key of added.slice(0, 30)) console.error(`  + ${key.split('\u0000').join(' · ')}`)
  if (removed.length > 0) console.error(`사라진 위반: ${removed.length}건`)
  process.exit(0)
}

const report = (list) => {
  const groups = new Map()
  for (const violation of list) {
    const bucket = groups.get(violation.rule) ?? []
    bucket.push(violation)
    groups.set(violation.rule, bucket)
  }
  const lines = []
  for (const [rule, bucket] of groups) {
    lines.push(`${rule} (${bucket.length}건, 상한 ${LIMITS[rule] ?? 0})`)
    for (const item of bucket.slice(0, 20)) {
      lines.push(`  ${item.file}:${item.line}  ${item.name}  ${item.value}`)
    }
    if (bucket.length > 20) lines.push(`  … ${bucket.length - 20}건 더`)
    lines.push('')
  }
  return lines
}

if (MODE === 'report') {
  console.log(
    JSON.stringify(
      { limits: LIMITS, stats, functions: functions.length, files: files.length },
      null,
      2,
    ),
  )
  console.log(report(violations).join('\n'))
  process.exit(0)
}

const fresh = violations.filter((violation) => !known.has(keyOf(violation)))
if (fresh.length === 0) {
  console.log(
    `코드 품질 게이트 통과 — 파일 ${files.length}개, 함수 ${functions.length}개, ` +
      `기준선 위반 ${known.size}건(신규 0건).`,
  )
  process.exit(0)
}

console.error(['코드 품질 게이트를 통과하지 못했다.', '', ...report(fresh)].join('\n'))
console.error('근거와 상한은 QUALITY.md 4절에 있다. 정말 예외라면 `--write-baseline`으로 남겨라.')
process.exit(1)
