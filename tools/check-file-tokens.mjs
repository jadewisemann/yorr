#!/usr/bin/env node
// 스테이징된 파일이 LLM 컨텍스트로 읽기 어려울 만큼 커지는 것을 커밋 단계에서 막는다.
//
// 왜 커밋 훅인가: 5000토큰을 넘는 파일은 통째로 읽는 순간 컨텍스트 대부분을 먹고,
// 에이전트가 그 파일을 다시 열지 않게 만든다. CI는 이미 커밋된 뒤에 알려 주지만
// 이 훅은 split 요구를 커밋 전에 되돌려 준다.
//
// 대상은 **스테이징된 내용**이다. 작업 트리가 아니라 인덱스를 읽으므로 부분
// 스테이징(`git add -p`)에서도 실제로 커밋될 모습을 잰다.
//
// 기존 대형 파일은 `tools/token-baseline.json`에 현재 토큰 수로 고정한다. 한 번
// 기록된 파일은 **그 수를 넘지 못하고**, 5000 이하로 줄면 기준선에서 지워야 한다.
// 이래야 훅을 켠 날부터 모든 문서 작업이 막히지 않으면서도 기준선은 줄어들기만 한다.
//
// 사용: `--staged`(기본, 훅) · `--all`(전체 검사, CI) · `--write-baseline`(기준선 갱신)
// 우회: `git commit --no-verify`
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const LIMIT = Number(process.env.TOKEN_LIMIT ?? 5000)
const BASELINE_PATH = 'tools/token-baseline.json'
const mode = process.argv.includes('--write-baseline')
  ? 'write'
  : process.argv.includes('--all')
    ? 'all'
    : 'staged'

let getEncoding
try {
  ;({ getEncoding } = await import('js-tiktoken'))
} catch {
  // 루트 의존성을 아직 설치하지 않은 클론. 커밋을 막지는 않고 한 번만 알린다.
  console.error(
    '경고: js-tiktoken이 없어 토큰 검사를 건너뛴다. `npm install`을 실행하라.',
  )
  process.exit(0)
}

// 잠금 파일·생성물은 사람이 읽는 코드가 아니므로 제외한다.
const EXCLUDED_PATH = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$|(^|\/)(dist|coverage|playwright-report|test-results|node_modules|deploy\/botkeep\/out)\//
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wav', '.ogg',
  '.zip', '.gz', '.br', '.pdf', '.wasm', '.glb', '.gltf',
])

const git = (args, options = {}) =>
  execFileSync('git', args, { encoding: 'buffer', ...options })

const isExcluded = (path) => EXCLUDED_PATH.test(path) || path === BASELINE_PATH

const isBinary = (path, content) => {
  const dot = path.lastIndexOf('.')
  if (dot !== -1 && BINARY_EXT.has(path.slice(dot).toLowerCase())) return true
  // git은 NUL 바이트가 앞부분에 있으면 바이너리로 본다.
  return content.subarray(0, 8000).includes(0)
}

// 인덱스(스테이징) 내용 또는 작업 트리 내용을 읽는다.
const readContent = (path) =>
  mode === 'staged' ? git(['show', `:${path}`]) : readFileSync(path)

const listFiles = () => {
  if (mode === 'staged') {
    return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
  }
  return git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {}

const encoder = getEncoding('cl100k_base')
const measurements = new Map()

for (const path of listFiles()) {
  if (isExcluded(path)) continue
  let content
  try {
    content = readContent(path)
  } catch {
    continue // 인덱스에서 사라진 경로(이름 변경·삭제 등)
  }
  if (isBinary(path, content)) continue
  measurements.set(path, encoder.encode(content.toString('utf8')).length)
}

if (mode === 'write') {
  const next = {}
  for (const [path, tokens] of [...measurements].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (tokens > LIMIT) next[path] = tokens
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)

  // 이 명령은 기준선을 올릴 수 있다 — 그래서 올라간 값을 반드시 말해 준다.
  // 기준선 변경은 PR diff에 남으므로, 리뷰가 성장을 승인하는 자리다.
  const grown = Object.entries(next).filter(
    ([path, tokens]) => baseline[path] !== undefined && tokens > baseline[path],
  )
  const added = Object.keys(next).filter((path) => baseline[path] === undefined)
  const removed = Object.keys(baseline).filter((path) => next[path] === undefined)

  console.error(`기준선을 다시 썼다: ${Object.keys(next).length}개 파일이 ${LIMIT}토큰 초과.`)
  if (grown.length > 0) {
    console.error('올라간 값(리뷰에서 확인하라):')
    for (const [path, tokens] of grown) {
      console.error(`  ${baseline[path].toLocaleString('en-US')} → ${tokens.toLocaleString('en-US')}  ${path}`)
    }
  }
  if (added.length > 0) console.error(`새로 들어온 파일: ${added.length}개`)
  if (removed.length > 0) console.error(`빠진 파일: ${removed.length}개`)
  process.exit(0)
}

const regressions = []
const growth = []

for (const [path, tokens] of measurements) {
  const allowed = baseline[path]
  if (allowed === undefined) {
    if (tokens > LIMIT) regressions.push({ path, tokens })
  } else if (tokens > allowed) {
    growth.push({ path, tokens, allowed })
  }
}

// 기준선이 낡았는지는 전체를 볼 때만 판단할 수 있다.
const stale = []
if (mode === 'all') {
  for (const [path, allowed] of Object.entries(baseline)) {
    const tokens = measurements.get(path)
    if (tokens === undefined || tokens <= LIMIT) {
      stale.push({ path, allowed, tokens })
    }
  }
}

if (regressions.length === 0 && growth.length === 0 && stale.length === 0) process.exit(0)

const lines = [`토큰 상한(${LIMIT.toLocaleString('en-US')}) 게이트를 통과하지 못했다.`, '']

if (regressions.length > 0) {
  regressions.sort((a, b) => b.tokens - a.tokens)
  lines.push('새 파일이 상한을 넘었다:')
  for (const { path, tokens } of regressions) {
    lines.push(`  ${tokens.toLocaleString('en-US')} 토큰  ${path}`)
  }
  lines.push('')
}

if (growth.length > 0) {
  growth.sort((a, b) => b.tokens - a.tokens)
  lines.push(`기준선보다 커졌다(${BASELINE_PATH}의 값이 상한이다):`)
  for (const { path, tokens, allowed } of growth) {
    lines.push(
      `  ${tokens.toLocaleString('en-US')} 토큰 (기준선 ${allowed.toLocaleString('en-US')})  ${path}`,
    )
  }
  lines.push('')
}

if (stale.length > 0) {
  lines.push('더 이상 상한을 넘지 않아 기준선에서 지워야 한다:')
  for (const { path, allowed, tokens } of stale) {
    lines.push(
      `  ${path}${tokens === undefined ? ' (파일 없음)' : ` (이제 ${tokens.toLocaleString('en-US')} 토큰)`}` +
        ` — 기준선 ${allowed.toLocaleString('en-US')}`,
    )
  }
  lines.push('')
  lines.push(`고친 뒤 \`npm run check:tokens -- --write-baseline\`을 실행하라.`)
  lines.push('')
}

lines.push('책임 단위로 파일을 나누거나, 내용을 문서·테스트로 옮겨라.')
lines.push('정말 예외라면 `git commit --no-verify`로 우회할 수 있다.')

console.error(lines.join('\n'))
process.exit(1)
