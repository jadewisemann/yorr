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
// 우회: `git commit --no-verify`
import { execFileSync } from 'node:child_process'

const LIMIT = Number(process.env.TOKEN_LIMIT ?? 5000)

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

const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const isBinary = (path, content) => {
  const dot = path.lastIndexOf('.')
  if (dot !== -1 && BINARY_EXT.has(path.slice(dot).toLowerCase())) return true
  // git은 NUL 바이트가 앞부분에 있으면 바이너리로 본다.
  return content.subarray(0, 8000).includes(0)
}

const encoder = getEncoding('cl100k_base')
const violations = []

for (const path of staged) {
  if (EXCLUDED_PATH.test(path)) continue

  let content
  try {
    content = git(['show', `:${path}`])
  } catch {
    continue // 인덱스에서 사라진 경로(이름 변경 등)
  }
  if (isBinary(path, content)) continue

  const tokens = encoder.encode(content.toString('utf8')).length
  if (tokens > LIMIT) violations.push({ path, tokens })
}

if (violations.length === 0) process.exit(0)

violations.sort((a, b) => b.tokens - a.tokens)
const report = violations
  .map(({ path, tokens }) => `  ${tokens.toLocaleString('en-US')} 토큰  ${path}`)
  .join('\n')

console.error(
  [
    `커밋이 막혔다: 파일 하나가 ${LIMIT.toLocaleString('en-US')} 토큰을 넘는다.`,
    '',
    report,
    '',
    '책임 단위로 파일을 나누거나, 내용을 문서·테스트로 옮겨라.',
    '정말 예외라면 `git commit --no-verify`로 우회할 수 있다.',
  ].join('\n'),
)
process.exit(1)
