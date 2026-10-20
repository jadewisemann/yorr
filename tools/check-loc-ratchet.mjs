#!/usr/bin/env node
// 파일당 500줄(비공백) 상한을 Biome 설정과 함께 지키는 래칫.
//
// 상한 자체는 `biome.json`의 `style/noExcessiveLinesPerFile`(error)이 강제한다.
// 이 스크립트가 맡는 것은 그 규칙이 지킬 수 없는 세 가지다.
//
//   1. 상한값이 조용히 올라가지 않았는가 — 설정이 500·error·skipBlankLines인지 확인.
//   2. 예외 목록이 늘어나지 않았는가 — 개수 상한을 넘으면 실패.
//   3. 예외가 신선한가 — 예외 파일이 500줄 이하로 줄었거나 사라졌으면 목록에서 지우라고 실패.
//
// 2·3이 함께 있어야 예외가 "영구 면제"가 아니라 **줄어들기만 하는 목록**이 된다.
// 예외는 `biome.json` overrides에서 규칙을 `off`로 끈 항목의 includes이며, 그래서
// 목록이 설정 파일 한 곳에만 존재한다.
//
// 사용: `node tools/check-loc-ratchet.mjs` (전체) / `--staged` (커밋 전 검사)
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const PACKAGES = ['backend', 'frontend']
const LIMIT = 500
// QUALITY.md 6절의 "예외 목록의 침식" 방지 장치. 예외를 줄였으면 이 숫자도 줄인다.
const MAX_EXCEPTIONS = 11
const staged = process.argv.includes('--staged')

const fail = (lines) => {
  console.error(lines.join('\n'))
  process.exit(1)
}

const nonBlankLines = (text) => text.split('\n').filter((l) => l.trim() !== '').length

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

// --- 2. 예외 목록: 개수와 신선도 --------------------------------------------
const exemptions = new Map() // `${pkg}/{path}` -> 규칙을 끈 설정
for (const pkg of PACKAGES) {
  for (const override of configs[pkg].overrides ?? []) {
    if (override.linter?.rules?.style?.noExcessiveLinesPerFile !== 'off') continue
    for (const include of override.includes ?? []) {
      exemptions.set(`${pkg}/${include.replace(/^\.\//, '')}`, { pkg, include })
    }
  }
}

if (exemptions.size > MAX_EXCEPTIONS) {
  fail([
    `예외가 ${exemptions.size}개로 상한(${MAX_EXCEPTIONS})을 넘었다.`,
    '기존 파일을 분할해 예외를 줄이거나, 늘려야 할 근거를 QUALITY.md에 남기고 여기 상한을 함께 고쳐라.',
  ])
}

const problems = []
for (const [key, { pkg, include }] of exemptions) {
  if (include.includes('*')) {
    problems.push(`  ${pkg}/biome.json: 예외 includes는 파일 경로여야 한다 — ${include}`)
    continue
  }
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
    if (!/^(backend|frontend)\/(src|scripts)\//.test(file)) continue
    if (exemptions.has(file)) continue
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(file)) continue

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
