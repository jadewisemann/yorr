/**
 * 소스 텍스트를 재는 토큰 수준 스캐너 — 주석·문자열을 지우고, 함수 경계와
 * 복잡도·할스테드·중첩을 계산한다.
 *
 * **완전한 파서가 아니다.** TypeScript 7(Go 포트)에는 `createSourceFile`이 없어
 * Compiler API를 쓸 수 없고, 새 `unstable/ast`는 안정성 보장이 없다. 그래서
 * "선언 헤더 + 중괄호 균형"으로 경계를 찾는다. 이 저장소는 포매터가 중괄호를
 * 강제하므로 실용적으로 충분하지만, 정규식으로 표현되지 않는 문법에서는 경계를
 * 놓칠 수 있다. 게이트가 **거짓 통과보다 거짓 실패**로 기울도록 만들었다 —
 * 놓친 것은 아무도 못 보고, 잘못 잡힌 것은 즉시 드러나기 때문이다.
 *
 * 순수 함수만 둔다(파일 읽기·git은 호출자 몫). 그래야 이 모듈 자체를 시험할 수 있다.
 */

/**
 * 주석·문자열·템플릿을 지운 "코드만 남은" 사본을 만든다. **줄 번호는 보존한다**
 * (개행은 그대로 두고 내용만 공백으로 바꾼다) — 위반 위치를 원본에서 읽어야 한다.
 */
export const stripNonCode = (text) => {
  const out = text.split('')
  let index = 0
  const blank = (from, to) => {
    for (let at = from; at < to; at += 1) if (out[at] !== '\n') out[at] = ' '
  }
  while (index < text.length) {
    const two = text.slice(index, index + 2)
    const one = text[index]
    if (two === '//') {
      const end = text.indexOf('\n', index)
      const stop = end === -1 ? text.length : end
      blank(index, stop)
      index = stop
      continue
    }
    if (two === '/*') {
      const end = text.indexOf('*/', index + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(index, stop)
      index = stop
      continue
    }
    if (one === '"' || one === "'" || one === '`') {
      let at = index + 1
      while (at < text.length) {
        if (text[at] === '\\') {
          at += 2
          continue
        }
        if (text[at] === one) break
        at += 1
      }
      blank(index + 1, Math.min(at, text.length))
      index = at + 1
      continue
    }
    index += 1
  }
  return out.join('')
}

const findMatchingBrace = (text, start) => {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return text.length - 1
}

/**
 * 타입 선언(`interface X { … }`·`type X = { … }`)의 본문 범위. 여기 안에서 발견된
 * "메서드"는 구현이 아니라 선언이므로 함수로 세지 않는다 — 걸러내지 않으면
 * `info(payload: unknown): void` 같은 한 줄이 함수로 잡힌다.
 */
export const typeBodyRanges = (code) => {
  const ranges = []
  const pattern =
    /\b(?:export\s+)?(?:declare\s+)?(?:interface\s+[A-Za-z_$][\w$]*|type\s+[A-Za-z_$][\w$]*(?:\s*<[^>]*>)?\s*=)[^{;]*\{/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1
    ranges.push({ start: open, end: findMatchingBrace(code, open) })
  }
  return ranges
}

/** 선언 시작점에서 실제 본문 `{`를 찾는다. 없으면(식 화살표) null. */
const bodyRange = (text, from) => {
  let index = from
  while (index < text.length && text[index] !== '{' && text[index] !== ';' && text[index] !== '\n') {
    // 매개변수 목록의 괄호는 건너뛴다 — 기본값에 객체 리터럴이 올 수 있다.
    if (text[index] === '(') {
      let depth = 0
      for (; index < text.length; index += 1) {
        if (text[index] === '(') depth += 1
        else if (text[index] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
    }
    index += 1
  }
  if (text[index] === '{') return { end: findMatchingBrace(text, index), start: index }
  return null
}

const lineOf = (text, offset) => {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/** 함수 선언·화살표 함수·클래스 메서드. 마지막 것은 들여쓰기로 판별한다. */
const FUNCTION_PATTERNS = [
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*\*?\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g,
  /^[ \t]+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm,
]

/** 키워드 뒤 괄호는 함수가 아니다(`switch (x) {`·`catch (e) {`). */
const KEYWORDS = new Set([
  'if', 'for', 'while', 'do', 'switch', 'case', 'default', 'catch', 'try', 'return', 'throw',
  'new', 'delete', 'typeof', 'void', 'await', 'yield', 'else', 'finally', 'break', 'continue',
  'const', 'let', 'var', 'function', 'class', 'import', 'export', 'super', 'this',
])

/**
 * 헤더의 괄호 안에서 쉼표로 나눈 매개변수 수(구조 분해는 1개로 센다).
 *
 * 쉼표를 세면 안 되는 자리가 셋이다: 타입 인자(`Record<string, number>`), 화살표 함수
 * 타입(`cb: () => void`), 끝 쉼표. 이것을 세면 멀쩡한 함수가 위반으로 잡혀 게이트가
 * 거짓말을 한다(실제로 `recordOnly`가 4개인데 6개로 보고됐다).
 */
const parametersOf = (code, headerStart, bodyStart) => {
  const open = code.indexOf('(', headerStart)
  if (open === -1 || open > bodyStart) return 0
  const segments = []
  let current = ''
  // 여는 '('는 이미 지났으므로 깊이 1에서 시작한다.
  let depth = 1
  let angle = 0
  for (let index = open + 1; index < bodyStart; index += 1) {
    const char = code[index]
    const previous = code[index - 1]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1 && char === '<' && /[\w$>)]/.test(previous ?? '')) angle += 1
    else if (depth === 1 && char === '>' && previous !== '=' && angle > 0) angle -= 1
    else if (depth === 1 && char === ',' && angle === 0) {
      segments.push(current)
      current = ''
      continue
    }
    if (depth >= 1) current += char
  }
  segments.push(current)
  // 끝 쉼표가 만든 빈 조각은 매개변수가 아니다.
  const filled = segments.filter((segment) => segment.trim() !== '')
  return filled.length
}

/** 함수 목록. `typeRanges`는 인터페이스·타입 리터럴 안의 시그니처를 거르는 데 쓴다. */
export const functionsOf = (code, typeRanges = typeBodyRanges(code)) => {
  const found = []
  const seen = new Set()
  for (const pattern of FUNCTION_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1]
      if (KEYWORDS.has(name)) continue
      const body = bodyRange(code, match.index + match[0].length - 1)
      if (body === null) continue
      if (typeRanges.some((range) => match.index > range.start && match.index < range.end)) continue
      // 중괄호가 같은 줄에서 바로 닫히는 한 줄짜리는 컨테이너·목업이다.
      if (body.end - body.start < 2) continue
      const key = `${name}:${body.start}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        name,
        body,
        startLine: lineOf(code, match.index),
        endLine: lineOf(code, body.end),
        parameters: parametersOf(code, match.index, body.start),
      })
    }
  }
  return found
}

/** 사이클로매틱 = 1 + 분기 수. */
const DECISION =
  /\b(?:if|for|while|case|catch)\b|\?\?|\?\.|&&|\|\||\?\s*[^:]+\s*:|\.(?:map|filter|reduce|some|every|find|forEach|flatMap)\s*\(/g
export const cyclomaticOf = (code) => 1 + (code.match(DECISION) ?? []).length

/** 중첩 깊이 최대값. */
/**
 * 중첩 깊이 최대값 — **제어 흐름 블록만** 센다.
 *
 * 중괄호를 전부 세면 객체 리터럴·JSX 표현식·타입 리터럴이 깊이로 잡혀, 분기가 하나도
 * 없는 함수가 위반이 된다(실제로 `createRemoteReleaseGate`가 5로 잡혔다 — 객체 메서드
 * 두 겹일 뿐이다). 그래서 `if`·`for`·`while`·`switch`·`try`·`catch`·`finally`·`else`·`do`
 * 뒤에 열리는 블록만 깊이에 넣는다.
 */
const CONTROL_BLOCK = /\b(?:if|for|while|switch|try|catch|finally|else|do)\b[^{]*$/

export const nestingOf = (code) => {
  const stack = []
  let max = 0
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]
    if (char === '{') {
      const before = code.slice(Math.max(0, index - 200), index)
      stack.push(CONTROL_BLOCK.test(before) ? 'control' : 'other')
      max = Math.max(max, stack.filter((kind) => kind === 'control').length)
    } else if (char === '}') {
      stack.pop()
    }
  }
  return max
}

/**
 * 할스테드 난이도 = (n1 / 2) × (N2 / n2).
 *
 *   n1 = 서로 다른 연산자, N1 = 연산자 총수, n2 = 서로 다른 피연산자, N2 = 피연산자 총수
 *
 * 연산자와 피연산자를 완전히 가르려면 파서가 필요하므로 **토큰 수준 근사**를 쓴다:
 * 키워드·구두점은 연산자, 식별자·리터럴은 피연산자다. 절대값보다 추세가 중요하다.
 */
export const halsteadOf = (code) => {
  const operators =
    code.match(
      /\b(?:if|else|for|while|do|switch|case|default|break|continue|return|throw|try|catch|finally|new|delete|typeof|instanceof|in|of|await|async|yield|function|class|extends|import|export|from|const|let|var|this|super)\b|[=+\-*/%<>!&|^~?:;,.()[\]{}]/g,
    ) ?? []
  const operands = code.match(/\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b/g) ?? []
  const n1 = new Set(operators).size
  const n2 = new Set(operands).size
  if (n1 === 0 || n2 === 0) return 0
  return (n1 / 2) * (operands.length / n2)
}
