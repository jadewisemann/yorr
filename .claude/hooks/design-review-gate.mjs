// DESIGN 일관성 검토 게이트 (PreToolUse: Bash)
//
// backend/src 코드 변경이 설계 문서 변경 없이 커밋되려 할 때, 커밋을 "딱 한 번"
// 멈추고 backend/AGENTS.md의 Reconcile 검토를 요구한다. 같은 변경으로 다시
// 커밋하면 통과한다 — 강제하는 것은 문서 수정이 아니라 검토다. 검토 결과
// "문서 변경 불필요"도 정당한 결론이므로, 의미 없는 문서 diff를 만들게 하지 않는다.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const pass = () => process.exit(0)

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  pass()
}
if (input.tool_name !== 'Bash') pass()

const command = String(input.tool_input?.command ?? '')
// 명령 구분자(&&, ;, |)를 넘지 않는 범위에서 "git ... commit"만 잡는다.
if (!/\bgit\b[^|;&\n]*\bcommit\b/.test(command)) pass()

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', cwd: input.cwd ?? process.cwd() })

let statusLines
try {
  statusLines = git(['status', '--porcelain']).split('\n').filter(Boolean)
} catch {
  pass() // git 저장소가 아니면 관여하지 않는다
}

const paths = statusLines.map((line) => {
  const p = line.slice(3)
  const arrow = p.indexOf(' -> ')
  return arrow === -1 ? p : p.slice(arrow + 4)
})

// 테스트만 바뀐 커밋은 설계 검토 대상이 아니다
const codeChanged = paths.some((p) => p.startsWith('backend/src/') && !p.includes('__tests__'))
if (!codeChanged) pass()

const DOC_PREFIXES = [
  'backend/DESIGN.md',
  'backend/IMPLEMENTATION_NOTES.md',
  'backend/PLANS.md',
  'backend/docs/',
]
const docsTouched = paths.some((p) => DOC_PREFIXES.some((d) => p === d || p.startsWith(d)))
if (docsTouched) pass()

// 같은 변경 내용에 대해서는 한 번만 멈춘다 — 변경 지문을 .git 아래에 기록
let diff = ''
try {
  diff = git(['diff', 'HEAD'])
} catch {
  // HEAD가 없는 신생 저장소 등 — 경로 목록만으로 지문을 만든다
}
const digest = createHash('sha256')
  .update([...paths].sort().join('\n'))
  .update(diff)
  .digest('hex')

const gitDir = git(['rev-parse', '--git-dir']).trim()
const markerPath = join(input.cwd ?? process.cwd(), gitDir, 'claude', 'design-review-ack')
try {
  if (readFileSync(markerPath, 'utf8').trim() === digest) pass()
} catch {
  // 마커 없음 — 처음 보는 변경
}

mkdirSync(dirname(markerPath), { recursive: true })
writeFileSync(markerPath, digest)

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'DESIGN 일관성 검토 (이 변경에 대해 이번 한 번만 멈춘다): backend/src 변경이 설계 문서 변경 없이 커밋되려 한다. backend/AGENTS.md의 Reconcile 단계대로 diff를 backend/DESIGN.md(및 해당 docs/design/*.md)와 대조하라 — 새 불변식·숨은 가정·설계 변경이 있으면 문서를 갱신해 함께 커밋하고, 검토 결과 문서 변경이 불필요하면 같은 커밋 명령을 그대로 다시 실행하면 통과된다.',
    },
  }),
)
process.exit(0)
