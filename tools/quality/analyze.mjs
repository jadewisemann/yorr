#!/usr/bin/env node
// TypeScript 소스의 구조 지표를 계산한다 — 사이클로매틱 복잡도·할스테드 난이도·
// 파일 라인 수·CRAP·타입 이완.
//
// 인지 복잡도가 여기에 없는 이유: Biome의 `noExcessiveCognitiveComplexity`가
// 이미 그 지표를 담당하므로(QUALITY.md 4절) 같은 값을 두 번 정의하지 않는다.
// report.mjs가 Biome 진단에서 수집한다.
//
// 파서로 저장소의 `typescript` 의존성을 쓰지 않는 이유: 이 저장소는 TypeScript 7을
// 쓰는데 7.x는 Go 네이티브 포팅이라 JS 컴파일러 API(`ts.createSourceFile`)를 내보내지
// 않는다. 그래서 분석 전용으로 5.x를 루트에 따로 둔다. TS 7은 5.9와 문법 집합이
// 같으므로 파싱에는 차이가 없다.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CONFIG = JSON.parse(readFileSync(join(import.meta.dirname, 'config.json'), 'utf8'))

// ── 파일 수집 ────────────────────────────────────────────────────────────────

function collectFiles(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
        found.push(full)
      }
    }
  }
  walk(root)
  return found.sort()
}

const isTestFile = (path) => path.includes('/__tests__/') || /\.(test|spec)\.tsx?$/.test(path)

// ── 토큰 분류 ────────────────────────────────────────────────────────────────

const TRIVIA = new Set([
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.ShebangTrivia,
  ts.SyntaxKind.ConflictMarkerTrivia,
])

const COMMENT = new Set([
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
])

// 할스테드에서 피연산자로 세는 토큰. 식별자와 리터럴이며, 나머지 키워드·구두점은
// 전부 연산자로 센다.
const OPERAND_KINDS = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
])

function scanTokens(text, jsx) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  )
  const tokens = []
  let previousEnd = -1
  while (true) {
    const kind = scanner.scan()
    if (kind === ts.SyntaxKind.EndOfFileToken) break
    const end = scanner.getTokenEnd()
    // 스캐너가 인식하지 못하는 문자를 만나도 위치는 항상 전진한다. 그래도 어떤
    // 입력이 그 전제를 깨면 여기서 무한 루프가 되므로 방어한다.
    if (end <= previousEnd) break
    previousEnd = end
    tokens.push({ kind, start: scanner.getTokenStart(), end, text: scanner.getTokenText() })
  }
  return tokens
}

// 코드 라인 수 — 주석과 빈 줄을 뺀 값이다. 여러 줄에 걸친 템플릿 리터럴은 그 줄들이
// 전부 코드이므로 범위 전체를 센다.
function countCodeLines(sourceFile, tokens) {
  const lines = new Set()
  for (const token of tokens) {
    if (TRIVIA.has(token.kind)) continue
    const from = sourceFile.getLineAndCharacterOfPosition(token.start).line
    const to = sourceFile.getLineAndCharacterOfPosition(Math.max(token.start, token.end - 1)).line
    for (let line = from; line <= to; line += 1) lines.add(line)
  }
  return lines.size
}

function countCommentLines(sourceFile, tokens) {
  const lines = new Set()
  for (const token of tokens) {
    if (!COMMENT.has(token.kind)) continue
    const from = sourceFile.getLineAndCharacterOfPosition(token.start).line
    const to = sourceFile.getLineAndCharacterOfPosition(Math.max(token.start, token.end - 1)).line
    for (let line = from; line <= to; line += 1) lines.add(line)
  }
  return lines.size
}

function halstead(tokens) {
  const operators = new Map()
  const operands = new Map()
  for (const token of tokens) {
    if (TRIVIA.has(token.kind)) continue
    const bucket = OPERAND_KINDS.has(token.kind) ? operands : operators
    const key = OPERAND_KINDS.has(token.kind) ? token.text : String(token.kind)
    bucket.set(key, (bucket.get(key) ?? 0) + 1)
  }
  const n1 = operators.size
  const n2 = operands.size
  const N1 = [...operators.values()].reduce((a, b) => a + b, 0)
  const N2 = [...operands.values()].reduce((a, b) => a + b, 0)
  const vocabulary = n1 + n2
  const length = N1 + N2
  const volume = vocabulary === 0 ? 0 : length * Math.log2(vocabulary)
  const difficulty = n2 === 0 ? 0 : (n1 / 2) * (N2 / n2)
  return {
    distinctOperators: n1,
    distinctOperands: n2,
    totalOperators: N1,
    totalOperands: N2,
    volume: round(volume),
    difficulty: round(difficulty),
    effort: round(difficulty * volume),
  }
}

const round = (value) => Math.round(value * 100) / 100

// ── 사이클로매틱 복잡도 ──────────────────────────────────────────────────────

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
])

const DECISION_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
])

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

// 중첩 함수는 자기 몫으로 따로 세고 바깥 함수에서는 빼는 방식을 쓴다. ESLint의
// `complexity` 규칙과 같은 관례이며, 그래야 콜백을 많이 쓰는 코드가 부모 함수
// 하나에 복잡도를 몰아 주지 않는다.
function cyclomaticOf(node) {
  let complexity = 1
  const visit = (child) => {
    if (FUNCTION_KINDS.has(child.kind)) return
    if (DECISION_KINDS.has(child.kind)) complexity += 1
    else if (ts.isCaseClause(child)) complexity += 1
    else if (ts.isBinaryExpression(child) && LOGICAL_OPERATORS.has(child.operatorToken.kind)) complexity += 1
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return complexity
}

function functionName(node, sourceFile) {
  if (node.kind === ts.SyntaxKind.Constructor) return 'constructor'
  if (node.name) return node.name.getText(sourceFile)
  // 이름 없는 함수는 대입 대상에서 이름을 빌린다 — `const roll = () => {}`처럼
  // 실제로 이름이 있는 자리를 "<anonymous>"로 뭉뚱그리면 리포트를 읽을 수 없다.
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText(sourceFile)
  if (parent && ts.isPropertyAssignment(parent) && parent.name) return parent.name.getText(sourceFile)
  if (parent && ts.isPropertyDeclaration(parent) && parent.name) return parent.name.getText(sourceFile)
  if (parent && ts.isCallExpression(parent)) return `${parent.expression.getText(sourceFile).slice(0, 40)}(…)`
  return '<anonymous>'
}

// ── 커버리지 결합(CRAP) ─────────────────────────────────────────────────────

// istanbul 포맷(`coverage-final.json`)에서 파일별 statement 위치와 실행 횟수를 읽어,
// 함수 범위에 걸친 statement의 실행 비율을 그 함수의 커버리지로 삼는다. 함수 단위
// 커버리지(`f`)는 "함수가 한 번이라도 불렸는가"만 알려 주므로 CRAP에 쓸 수 없다.
function loadCoverage(coveragePath) {
  try {
    return JSON.parse(readFileSync(coveragePath, 'utf8'))
  } catch {
    return null
  }
}

function coverageForFile(coverage, absolutePath) {
  if (!coverage) return null
  return coverage[absolutePath] ?? coverage[relative(REPO_ROOT, absolutePath)] ?? null
}

function functionCoverage(fileCoverage, startLine, endLine) {
  if (!fileCoverage) return null
  const { statementMap = {}, s = {} } = fileCoverage
  let total = 0
  let covered = 0
  for (const [id, location] of Object.entries(statementMap)) {
    const line = location.start.line
    if (line < startLine + 1 || line > endLine + 1) continue
    total += 1
    if ((s[id] ?? 0) > 0) covered += 1
  }
  if (total === 0) return null
  return covered / total
}

const crapOf = (complexity, coverage) =>
  coverage === null ? null : round(complexity ** 2 * (1 - coverage) ** 3 + complexity)

// ── 타입 이완 스캔 ───────────────────────────────────────────────────────────

// Biome의 `noExplicitAny`가 잡지 못하는 자리까지 세려고 텍스트로 훑는다.
// `as unknown as`와 억제 주석은 규칙이 아니라 문법·주석이라 린터로는 보이지 않는다.
const LAXITY_PATTERNS = {
  explicitAny: /(?::\s*any\b|\bas\s+any\b|<any>|\bany\[\])/g,
  unknownCast: /\bas\s+unknown\s+as\b/g,
  biomeIgnore: /biome-ignore\b/g,
  tsSuppression: /@ts-(?:ignore|expect-error|nocheck)\b/g,
}

function scanLaxity(text, relativePath) {
  const hits = {}
  for (const [name, pattern] of Object.entries(LAXITY_PATTERNS)) {
    pattern.lastIndex = 0
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      hits[name] = matches.map((match) => ({
        file: relativePath,
        line: text.slice(0, match.index).split('\n').length,
        text: match[0],
      }))
    }
  }
  return hits
}

// ── 분석 ─────────────────────────────────────────────────────────────────────

function analyzeTarget(target) {
  const root = join(REPO_ROOT, target.root)
  const coverage = loadCoverage(join(REPO_ROOT, target.coverage))
  const files = []
  const functions = []
  const laxity = { explicitAny: [], unknownCast: [], biomeIgnore: [], tsSuppression: [] }

  for (const absolutePath of collectFiles(root)) {
    const text = readFileSync(absolutePath, 'utf8')
    const relativePath = relative(REPO_ROOT, absolutePath)
    const jsx = absolutePath.endsWith('.tsx')
    const sourceFile = ts.createSourceFile(absolutePath, text, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const tokens = scanTokens(text, jsx)
    const fileCoverage = coverageForFile(coverage, absolutePath)
    const test = isTestFile(relativePath)

    const fileFunctions = []
    const visit = (node) => {
      if (FUNCTION_KINDS.has(node.kind)) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line
        const complexity = cyclomaticOf(node)
        const bodyTokens = tokens.filter((token) => token.start >= node.getStart(sourceFile) && token.end <= node.getEnd())
        const metrics = halstead(bodyTokens)
        const covered = test ? null : functionCoverage(fileCoverage, startLine, endLine)
        fileFunctions.push({
          file: relativePath,
          name: functionName(node, sourceFile),
          line: startLine + 1,
          lines: endLine - startLine + 1,
          cyclomatic: complexity,
          halsteadDifficulty: metrics.difficulty,
          halsteadVolume: metrics.volume,
          coverage: covered === null ? null : round(covered),
          crap: crapOf(complexity, covered),
        })
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)

    const totalLines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    files.push({
      file: relativePath,
      test,
      totalLines,
      codeLines: countCodeLines(sourceFile, tokens),
      commentLines: countCommentLines(sourceFile, tokens),
      functions: fileFunctions.length,
      maxCyclomatic: fileFunctions.reduce((max, fn) => Math.max(max, fn.cyclomatic), 0),
      maxHalsteadDifficulty: fileFunctions.reduce((max, fn) => Math.max(max, fn.halsteadDifficulty), 0),
      halsteadDifficulty: halstead(tokens).difficulty,
    })
    functions.push(...fileFunctions)

    for (const [name, hits] of Object.entries(scanLaxity(text, relativePath))) {
      laxity[name].push(...hits)
    }
  }

  return { name: target.name, root: target.root, coverageLoaded: coverage !== null, files, functions, laxity }
}

const result = {
  generatedAt: new Date().toISOString(),
  thresholds: CONFIG.thresholds,
  targets: CONFIG.targets.map(analyzeTarget),
}

const outIndex = process.argv.indexOf('--out')
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  const outPath = resolve(REPO_ROOT, process.argv[outIndex + 1])
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`구조 지표를 ${relative(REPO_ROOT, outPath)}에 기록했다.`)
} else {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
