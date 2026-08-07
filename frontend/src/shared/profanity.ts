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

const blocked = [
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
  'ㅅㅂ',
  'ㅆㅂ',
  'ㅄ',
  'ㅂㅅ',
  'ㅈㄴ',
  'ㄷㅊ',
  'ㅈㄹ',
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
