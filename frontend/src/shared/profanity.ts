/**
 * 사용자가 입력해 <b>다른 사람에게 보이는</b> 텍스트(지금은 닉네임뿐)의 욕설·외설 필터.
 *
 * 프런트의 역할은 "실수로 화면에 튀어나오는 것"을 막는 층이다. 결정적인 차단은 서버에
 * 있어야 한다 — 클라이언트 검증은 언제든 우회된다.
 *
 * 검사 자리를 여기 한 곳으로 모은다. 화면마다 목록을 따로 두면 어느 화면은 막고 어느
 * 화면은 안 막는 상태가 되고, 실제로 닉네임 변경 경로가 그랬다(S15P11A406-182).
 */

/**
 * 비교 전 정규화. 글자·숫자만 남기고 소문자로 내린 뒤 흔한 치환 문자를 되돌린다 —
 * `ㅅ.ㅂ` · `s h i t` · `f4ck` 같은 얕은 우회를 같은 문자열로 만든다.
 */
function normalize(value: string) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
}

/**
 * 금칙어. 정규화된 문자열에 <b>부분 문자열</b>로 들어 있으면 걸린다.
 *
 * ponytail: 부분 문자열 매칭이라 `보지마` 같은 정상 조합도 걸릴 수 있다. 닉네임은
 * 12자 제한이고 걸려도 다시 지으면 그만이라 이 비용을 받는다 — 오탐이 실제로 문제가
 * 되면 그때 단어 경계·화이트리스트를 붙인다. 자모 분해(ㅅㅣㅂㅏㄹ)와 유사 글자
 * 치환(시1발)은 막지 않는다. 목록이 부족하면 여기에 단어만 더한다.
 */
const blocked = [
  // 한국어
  '시발',
  '씨발',
  '시바루',
  '씨팔',
  '시팔',
  '씹',
  '좆',
  '좃',
  '병신',
  '븅신',
  '빙신',
  '개새끼',
  '개색기',
  '지랄',
  '니미',
  '애미',
  '엠창',
  '창녀',
  '보지',
  '자지',
  '섹스',
  '따먹',
  '강간',
  '변태',
  '미친놈',
  '미친년',
  '등신',
  '호로',
  // 초성
  'ㅅㅂ',
  'ㅆㅂ',
  'ㅄ',
  'ㅂㅅ',
  'ㅈㄴ',
  'ㄷㅊ',
  'ㅈㄹ',
  // 영어 — 짧은 단어(ass 등)는 정상 단어 안에 흔히 들어가 넣지 않는다.
  'fuck',
  'fuk',
  'shit',
  'bitch',
  'cunt',
  'whore',
  'pussy',
  'nigger',
  'nigga',
  'faggot',
  'asshole',
  'bastard',
  'slut',
  'retard',
  'wanker',
  'dick',
  'penis',
  'vagina',
  'porn',
  'sex',
] as const

export function containsProfanity(value: string) {
  const normalized = normalize(value)
  return blocked.some((word) => normalized.includes(normalize(word)))
}
