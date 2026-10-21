#!/usr/bin/env node
// 파일당 500줄(비공백) 상한을 Biome 설정과 함께 지키는 래칫.
//
// 상한 자체는 `biome.json`의 `style/noExcessiveLinesPerFile`(error)이 강제한다.
// 이 스크립트가 맡는 것은 그 규칙이 지킬 수 없는 것들이다.
//
//   1. 상한값이 조용히 올라가지 않았는가 — 설정이 500·error·skipBlankLines인지 확인.
//   2. 파일별 예외가 늘어나지 않았는가 — 개수 상한을 넘으면 실패.
//   3. 파일별 예외가 신선한가 — 예외 파일이 500줄 이하로 줄었거나 사라졌으면 지우라고 실패.
//
// 2·3이 함께 있어야 예외가 "영구 면제"가 아니라 **줄어들기만 하는 목록**이 된다.
//
// 예외는 두 종류로 나눈다. 둘 다 `biome.json` overrides에 있지만 뜻이 다르다.
//
//   - **범위 제외(glob)** — 테스트·CSS처럼 줄 수가 의미 없는 부류. 파일이 늘어도
//     예외 개수에 세지 않는다. 대신 glob이 파일 목록으로 몰래 좁혀지지 않게
//     `*` 없는 항목만 개별 예외로 센다.
//   - **파일 예외(경로)** — 위반했지만 아직 분할하지 않은 코드. 개수와 신선도를
//     모두 검사한다.
//
// 사용: `node tools/check-loc-ratchet.mjs` (전체) / `--staged` (커밋 전 검사)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'

const PACKAGES = ['backend', 'frontend']
const LIMIT = 500
// QUALITY.md 6절의 "예외 목록의 침식" 방지 장치. 예외를 줄였으면 이 숫자도 줄인다.
const MAX_FILE_EXCEPTIONS = 4
const staged = process.argv.includes('--staged')

const fail = (lines) => {
  console.error(lines.join('\n'))
  process.exit(1)
}

const nonBlankLines = (text) => text.split('\n').filter((l) => l.trim() !== '').length

// 범위 제외 glob 판정은 `node:path`의 `matchesGlob`(Node 22.5+)에 맡긴다. 예전에는
// 이 설정이 쓰는 형태(`**/x`·`x/**`·`*.ext`·`{a,b}`)만 지원하는 변환기를 직접
// 들고 있었는데, 저장소 전체 957개 파일에서 두 판정이 완전히 같음을 확인하고
// 지웠다 — Biome의 glob 의미론과 갈라질 위험을 직접 관리하지 않아도 된다.

// --- 1. 규칙이 실제로 켜져 있는지 -------------------------------------------
const configs = {}
for (const pkg of PACKAGES) {
  const path = `${pkg}/biome.json`
  let config
  try {
    config = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail([`${path}를 읽을 수 없다: ${error.message}`])
  }
  configs[pkg] = config

  const rule = config.linter?.rules?.style?.noExcessiveLinesPerFile
  const options = typeof rule === 'object' ? rule.options : undefined
  if (
    typeof rule !== 'object' ||
    rule.level !== 'error' ||
    options?.maxLines !== LIMIT ||
    options?.skipBlankLines !== true
  ) {
    fail([
      `${path}: noExcessiveLinesPerFile이 error/${LIMIT}줄/skipBlankLines로 켜져 있지 않다.`,
      '상한을 올리려면 QUALITY.md의 결정을 먼저 바꾸고 이 스크립트의 LIMIT도 함께 고쳐라.',
    ])
  }
}

// 범위 제외로 인정하는 glob. 이 목록에 없는 glob이 설정에 나타나면 실패한다.
// 그렇지 않으면 `"src/**"` 같은 한 줄로 저장소 전체의 규칙을 조용히 끌 수 있다.
// 테스트·CSS는 줄 수가 의미 없는 부류라는 3절 (b)의 결정을 코드로 옮긴 것이다.
const ALLOWED_SCOPE_PATTERNS = {
  backend: ['**/__tests__/**', 'test/**'],
  frontend: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'e2e/**', '**/*.css'],
}

// --- 2. 예외: 범위 제외와 파일 예외를 나눈다 --------------------------------
const scopePatterns = [] // { pkg, pattern }
const fileExceptions = new Map() // `${pkg}/{path}` -> { pkg, include }

for (const pkg of PACKAGES) {
  for (const override of configs[pkg].overrides ?? []) {
    if (override.linter?.rules?.style?.noExcessiveLinesPerFile !== 'off') continue
    for (const include of override.includes ?? []) {
      if (!include.includes('*')) {
        fileExceptions.set(`${pkg}/${include.replace(/^\.\//, '')}`, { pkg, include })
        continue
      }
      if (!ALLOWED_SCOPE_PATTERNS[pkg].includes(include)) {
        fail([
          `${pkg}/biome.json: 허용되지 않은 범위 제외 glob이다 — ${include}`,
          `허용: ${ALLOWED_SCOPE_PATTERNS[pkg].join(', ')}`,
          '이 목록을 넓히려면 QUALITY.md 3절 (b)의 결정을 먼저 바꿔라.',
        ])
      }
      scopePatterns.push({ pkg, pattern: include })
    }
  }
}

// 설정에서 사라진 허용 glob도 알린다 — 테스트가 다시 규칙 대상이 된 경우다.
for (const pkg of PACKAGES) {
  for (const pattern of ALLOWED_SCOPE_PATTERNS[pkg]) {
    if (!scopePatterns.some((entry) => entry.pkg === pkg && entry.pattern === pattern)) {
      fail([`${pkg}/biome.json: 범위 제외 glob이 빠졌다 — ${pattern}`])
    }
  }
}

const isScopeExcluded = (file) => {
  const [pkg, ...rest] = file.split('/')
  const relative = rest.join('/')
  return scopePatterns.some((entry) => entry.pkg === pkg && matchesGlob(relative, entry.pattern))
}

if (fileExceptions.size > MAX_FILE_EXCEPTIONS) {
  fail([
    `파일 예외가 ${fileExceptions.size}개로 상한(${MAX_FILE_EXCEPTIONS})을 넘었다.`,
    '기존 파일을 분할해 예외를 줄이거나, 늘려야 할 근거를 QUALITY.md에 남기고 여기 상한을 함께 고쳐라.',
  ])
}

const problems = []
for (const [key, { pkg }] of fileExceptions) {
  if (!existsSync(key)) {
    problems.push(`  ${key}: 파일이 없다. 예외를 지워라.`)
    continue
  }
  const lines = nonBlankLines(readFileSync(key, 'utf8'))
  if (lines <= LIMIT) {
    problems.push(`  ${key}: 이제 ${lines}줄이다. 더 이상 예외가 아니므로 지워라.`)
  }
}

// --- 3. 스테이징된 파일 중 새 위반 -------------------------------------------
if (staged) {
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)

  for (const file of files) {
    if (!/^(backend|frontend)\/(src|scripts|test|e2e)\//.test(file)) continue
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(file)) continue
    if (fileExceptions.has(file) || isScopeExcluded(file)) continue

    // 인덱스 내용을 잰다 — 커밋될 모습 그대로.
    const lines = nonBlankLines(git(['show', `:${file}`]))
    if (lines > LIMIT) problems.push(`  ${file}: ${lines}줄 (상한 ${LIMIT})`)
  }
}

if (problems.length > 0) {
  fail([
    '파일당 줄 수 게이트를 통과하지 못했다.',
    '',
    ...problems,
    '',
    '책임 단위로 파일을 나눠라. 상한과 예외 규칙은 QUALITY.md에 있다.',
  ])
}
