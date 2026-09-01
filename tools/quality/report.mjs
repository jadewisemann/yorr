#!/usr/bin/env node
// QUALITY.md의 11개 지표를 한 자리에 모아 보여 준다.
//
// 지표마다 측정 주체가 다르다 — 구조 지표는 analyze.mjs, 인지 복잡도는 Biome,
// 죽은 코드는 knip, 중복은 jscpd, 커버리지는 Vitest, 돌연변이는 Stryker다.
// 이 스크립트는 그 산출물을 모아 한 표로 만들고, `--gate`에서 **켜져 있는 게이트만**
// 검사한다. 어떤 게이트가 켜져 있는지는 config.json의 `enforced`가 정한다 —
// 단계적으로 켜는 것이 계획이므로 켜짐 여부가 코드가 아니라 설정에 있어야 한다.
//
// 사용법:
//   node tools/quality/report.mjs                 측정하고 표를 출력한다
//   node tools/quality/report.mjs --baseline      tools/quality/baseline.json에 기록한다
//   node tools/quality/report.mjs --gate          켜진 게이트를 검사하고 위반이면 1로 끝난다
//   node tools/quality/report.mjs --coverage      커버리지를 새로 측정한다(느리다)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const HERE = import.meta.dirname
const CONFIG = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))
const ARGS = new Set(process.argv.slice(2))

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const readJson = (path) => {
  try {
    return parseJson(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// 하위 도구는 위반을 찾으면 0이 아닌 코드로 끝난다. 그것은 이 스크립트에게는
// 정상적인 결과이므로 종료 코드를 삼키고 stdout만 본다.
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    return error.stdout ?? ''
  }
}

const npx = (args, options) => run('npx', ['--no-install', ...args], options)

// ── 측정 ─────────────────────────────────────────────────────────────────────

process.stderr.write('구조 지표 측정 중…\n')
run('node', [join(HERE, 'analyze.mjs'), '--out', join(HERE, '.metrics.json')])
const metrics = readJson(join(HERE, '.metrics.json'))
if (!metrics) {
  console.error('구조 지표를 측정하지 못했다. node tools/quality/analyze.mjs를 직접 실행해 원인을 본다.')
  process.exit(2)
}

process.stderr.write('죽은 코드 검사 중…\n')
writeFileSync(join(HERE, '.knip.json'), npx(['knip', '--no-progress', '--reporter', 'json']) || '{}')
const knip = readJson(join(HERE, '.knip.json'))

process.stderr.write('중복 검사 중…\n')
npx(['jscpd', 'backend/src', 'frontend/src'])
const jscpd = readJson(join(HERE, '.jscpd/jscpd-report.json'))

process.stderr.write('린트 진단 수집 중…\n')
const biome = {}
for (const target of CONFIG.targets) {
  const workspace = target.root.split('/')[0]
  biome[target.name] = parseJson(npx(['biome', 'check', '--reporter=json', '.'], { cwd: join(REPO_ROOT, workspace) }))
}

if (ARGS.has('--coverage')) {
  for (const target of CONFIG.targets) {
    const workspace = target.root.split('/')[0]
    process.stderr.write(`${target.name} 커버리지 측정 중…\n`)
    npx(['vitest', 'run', '--coverage'], { cwd: join(REPO_ROOT, workspace) })
  }
}

const coverage = {}
for (const target of CONFIG.targets) {
  const workspace = target.root.split('/')[0]
  coverage[target.name] = readJson(join(REPO_ROOT, workspace, 'coverage/coverage-summary.json'))?.total ?? null
}

const mutation = readJson(join(HERE, '.stryker.json'))

// ── 지표 집계 ────────────────────────────────────────────────────────────────

const { thresholds } = CONFIG
// 예외로 적힌 파일은 그 지표에서만 빼고 센다. 예외 목록 자체는 아래에서 개수를 감시한다.
const waived = (metric, file) =>
  CONFIG.waivers.files.some((entry) => entry.metric === metric && entry.file === file)
const allFiles = metrics.targets.flatMap((t) => t.files)
const allFunctions = metrics.targets.flatMap((t) => t.functions)
const laxity = metrics.targets.reduce(
  (acc, t) => ({
    explicitAny: [...acc.explicitAny, ...t.laxity.explicitAny],
    unknownCast: [...acc.unknownCast, ...t.laxity.unknownCast],
    biomeIgnore: [...acc.biomeIgnore, ...t.laxity.biomeIgnore],
    tsSuppression: [...acc.tsSuppression, ...t.laxity.tsSuppression],
  }),
  { explicitAny: [], unknownCast: [], biomeIgnore: [], tsSuppression: [] },
)

const cognitiveDiagnostics = Object.values(biome)
  .flatMap((report) => report?.diagnostics ?? [])
  .filter((d) => String(d.category ?? '').includes('noExcessiveCognitiveComplexity'))

const knipIssues = knip?.issues ?? []
const deadExports = knipIssues.reduce((sum, issue) => sum + (issue.exports?.length ?? 0) + (issue.types?.length ?? 0), 0)
const deadFiles = knip?.files?.length ?? 0
const deadDependencies = knipIssues.reduce(
  (sum, issue) => sum + (issue.dependencies?.length ?? 0) + (issue.devDependencies?.length ?? 0),
  0,
)

// 라인 수·복잡도 기준은 프로덕션 코드와 테스트 코드에 다르게 적용된다
// (QUALITY.md 3절 (b)): 테스트에는 라인 수만 적용하고 복잡도·CRAP은 적용하지 않는다.
const productionFunctions = allFunctions.filter((fn) => {
  const file = allFiles.find((f) => f.file === fn.file)
  return file && !file.test
})

const violations = {
  cyclomatic: productionFunctions.filter((fn) => fn.cyclomatic > thresholds.cyclomatic),
  halstead: productionFunctions.filter((fn) => fn.halsteadDifficulty > thresholds.halsteadDifficulty),
  crap: productionFunctions.filter((fn) => fn.crap !== null && fn.crap > thresholds.crap),
  fileLines: allFiles.filter(
    (f) => f.codeLines > thresholds.fileLines && !waived('fileLines', f.file),
  ),
  cognitive: cognitiveDiagnostics,
}

const waiverCount = CONFIG.waivers.files.length
const metricRows = [
  {
    id: 1,
    name: '사이클로매틱 복잡도',
    goal: `< ${thresholds.cyclomatic}`,
    value: `최대 ${Math.max(0, ...productionFunctions.map((f) => f.cyclomatic))}`,
    violations: violations.cyclomatic.length,
  },
  {
    id: 2,
    name: '인지 복잡도',
    goal: `< ${thresholds.cognitive}`,
    value: `Biome 진단 ${cognitiveDiagnostics.length}건`,
    violations: cognitiveDiagnostics.length,
  },
  {
    id: 3,
    name: '할스테드 난이도',
    goal: `< ${thresholds.halsteadDifficulty}`,
    value: `최대 ${Math.max(0, ...productionFunctions.map((f) => f.halsteadDifficulty))}`,
    violations: violations.halstead.length,
  },
  {
    id: 4,
    name: '파일당 코드 라인',
    goal: `< ${thresholds.fileLines}`,
    value: `최대 ${Math.max(0, ...allFiles.filter((f) => !waived('fileLines', f.file)).map((f) => f.codeLines))}`,
    violations: violations.fileLines.length,
  },
  {
    id: 5,
    name: '테스트 커버리지',
    goal: '100%',
    value: Object.entries(coverage)
      .map(([name, total]) => `${name} ${total ? `${total.lines.pct}%` : '미측정'}`)
      .join(' · '),
    violations: Object.values(coverage).filter((total) => total && total.lines.pct < 100).length,
  },
  {
    id: 6,
    name: 'CRAP',
    goal: `< ${thresholds.crap}`,
    value: `최대 ${Math.max(0, ...productionFunctions.map((f) => f.crap ?? 0))}`,
    violations: violations.crap.length,
  },
  {
    id: 7,
    name: '생존 돌연변이',
    goal: '0',
    value: mutation ? `${mutation.survived ?? '?'}건` : '미측정(Stryker 미도입)',
    violations: mutation?.survived ?? null,
  },
  {
    id: 8,
    name: '죽은 코드',
    goal: '0',
    value: `export ${deadExports} · 파일 ${deadFiles} · 의존성 ${deadDependencies}`,
    violations: deadExports + deadFiles + deadDependencies,
  },
  {
    id: 9,
    name: '중복 코드',
    goal: `0 (${jscpd?.statistics?.total ? '50토큰 이상' : '미측정'})`,
    value: jscpd ? `${jscpd.duplicates.length}쌍 · ${jscpd.statistics.total.percentage.toFixed(2)}%` : '미측정',
    violations: jscpd?.duplicates.length ?? null,
  },
  { id: 10, name: '`any` 타입', goal: '0', value: `${laxity.explicitAny.length}건`, violations: laxity.explicitAny.length },
  {
    id: 11,
    name: '`unknown` 이완',
    goal: '0',
    value: `as unknown as ${laxity.unknownCast.length}건 · 억제 주석 ${laxity.biomeIgnore.length + laxity.tsSuppression.length}건`,
    violations: laxity.unknownCast.length,
  },
]

// ── 출력 ─────────────────────────────────────────────────────────────────────

const enforced = new Set(CONFIG.enforced ?? [])
// 래칫은 "0"이 아니라 "지금보다 나빠지지 않기"를 강제한다. 절대 기준을 당장 걸 수
// 없는 지표(계약 재설계를 기다리는 캐스트, 아직 덜 쪼갠 테스트 파일)를 방치하지 않고
// 붙잡아 두는 장치다 — 값을 줄이면 상한도 함께 줄여 되돌아가지 못하게 한다.
const ratchets = Object.fromEntries(
  Object.entries(CONFIG.ratchets ?? {}).filter(([key]) => !key.startsWith('_')),
)
const GATE_KEYS = {
  1: 'cyclomatic',
  2: 'cognitive',
  3: 'halstead',
  4: 'fileLines',
  5: 'coverage',
  6: 'crap',
  7: 'mutation',
  8: 'deadCode',
  9: 'duplication',
  10: 'explicitAny',
  11: 'unknownCast',
}

const pad = (text, width) => {
  // 한글은 터미널에서 두 칸을 차지한다. 그것을 세지 않으면 표가 어긋난다.
  const printed = [...String(text)].reduce((sum, ch) => sum + (/[ᄀ-ᇿ　-〿가-힯＀-￯]/.test(ch) ? 2 : 1), 0)
  return String(text) + ' '.repeat(Math.max(0, width - printed))
}

console.log('\n지표 현황 — QUALITY.md 11개 기준\n')
console.log(`${pad('#', 3)}${pad('지표', 22)}${pad('목표', 17)}${pad('현재', 40)}${pad('위반', 8)}게이트`)
console.log('─'.repeat(98))
for (const row of metricRows) {
  const gateOn = enforced.has(GATE_KEYS[row.id])
  const key = GATE_KEYS[row.id]
  const limit = ratchets[key]
  const status = row.violations === null ? '—' : row.violations === 0 ? '충족' : `${row.violations}`
  const gate = gateOn ? '켜짐' : limit === undefined ? '꺼짐' : `래칫 ≤${limit}`
  console.log(`${pad(row.id, 3)}${pad(row.name, 22)}${pad(row.goal, 17)}${pad(row.value, 40)}${pad(status, 8)}${gate}`)
}
console.log(`\n예외 목록: ${waiverCount}개 (상한 ${CONFIG.waivers.maxCount})`)

if (ARGS.has('--baseline')) {
  // QUALITY.md는 이 파일을 `docs/`에 두라고 적었지만 루트 .gitignore가 `/docs/`를
  // 통째로 무시한다(로컬 기획 자료 보관용). 기준선은 커밋되어야 래칫의 바닥이 되므로
  // 도구와 같은 자리에 둔다.
  const baselinePath = join(REPO_ROOT, 'tools/quality/baseline.json')
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(
    baselinePath,
    `${JSON.stringify(
      {
        generatedAt: metrics.generatedAt,
        thresholds,
        note: 'QUALITY.md 0단계 기준선. 이 값들은 게이트가 아니라 출발점이며, 래칫의 바닥으로 쓴다.',
        metrics: metricRows.map(({ id, name, goal, value, violations: count }) => ({ id, name, goal, value, violations: count })),
        details: {
          files: metrics.targets.map((t) => ({
            target: t.name,
            files: t.files.length,
            productionFiles: t.files.filter((f) => !f.test).length,
            functions: t.functions.length,
            maxCodeLines: Math.max(0, ...t.files.map((f) => f.codeLines)),
            over500: t.files.filter((f) => f.codeLines > thresholds.fileLines).map((f) => ({ file: f.file, codeLines: f.codeLines, totalLines: f.totalLines, test: f.test })),
          })),
          cyclomaticOver: violations.cyclomatic.map((f) => ({ file: f.file, name: f.name, line: f.line, value: f.cyclomatic })),
          halsteadOver: violations.halstead.map((f) => ({ file: f.file, name: f.name, line: f.line, value: f.halsteadDifficulty })),
          crapOver: violations.crap.slice(0, 50).map((f) => ({ file: f.file, name: f.name, line: f.line, value: f.crap, coverage: f.coverage })),
          coverage,
          deadCode: { exports: deadExports, files: deadFiles, dependencies: deadDependencies },
          duplication: jscpd?.statistics?.total ?? null,
          typeLaxity: {
            explicitAny: laxity.explicitAny.length,
            unknownCast: laxity.unknownCast.length,
            biomeIgnore: laxity.biomeIgnore.length,
            tsSuppression: laxity.tsSuppression.length,
          },
        },
      },
      null,
      2,
    )}\n`,
  )
  console.log('\n기준선을 tools/quality/baseline.json에 기록했다.')
}

if (ARGS.has('--gate')) {
  const failures = metricRows.filter((row) => enforced.has(GATE_KEYS[row.id]) && row.violations)
  const overRatchet = metricRows.filter((row) => {
    const limit = ratchets[GATE_KEYS[row.id]]
    return limit !== undefined && row.violations !== null && row.violations > limit
  })
  // 상한보다 낮아졌으면 알려 준다. 조이지 않고 두면 다음 사람이 그만큼 되돌려 놓아도
  // 게이트가 잡지 못한다.
  const slack = metricRows.filter((row) => {
    const limit = ratchets[GATE_KEYS[row.id]]
    return limit !== undefined && row.violations !== null && row.violations < limit
  })
  if (slack.length > 0) {
    console.log('\n래칫을 조일 수 있다 — config.json의 ratchets를 현재 값으로 낮춘다:')
    for (const row of slack)
      console.log(`  ${GATE_KEYS[row.id]}: ${ratchets[GATE_KEYS[row.id]]} → ${row.violations}`)
  }
  if (waiverCount > CONFIG.waivers.maxCount) {
    console.error(`\n예외 목록이 상한을 넘었다: ${waiverCount} > ${CONFIG.waivers.maxCount}`)
    console.error('예외를 늘리는 대신 코드를 고치거나, 상한을 올리는 결정을 문서에 남긴다.')
    process.exit(1)
  }
  if (overRatchet.length > 0) {
    console.error('\n래칫이 뒤로 밀렸다:')
    for (const row of overRatchet)
      console.error(
        `  ${row.id}. ${row.name} — ${row.violations}건 (상한 ${ratchets[GATE_KEYS[row.id]]})`,
      )
    process.exit(1)
  }
  if (failures.length > 0) {
    console.error('\n켜진 게이트에서 위반이 발견되었다:')
    for (const row of failures) console.error(`  ${row.id}. ${row.name} — ${row.violations}건 (목표 ${row.goal})`)
    process.exit(1)
  }
  console.log('\n켜진 게이트를 모두 통과했다.')
}
