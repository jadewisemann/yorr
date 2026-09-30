import { CLIENT_MESSAGE_TYPES } from '../blackbox/contract.js'
import { YACHT_CATEGORIES } from '../oracles/yacht.js'
import type { Prng } from './prng.js'

/**
 * WS 프레임 생성기 — 시드 하나에서 모든 프레임이 나온다(`prng.ts`).
 *
 * 무작위 바이트는 서버의 첫 관문(JSON 파싱)에서 전부 걸러져 안쪽 코드를 거의 두드리지 못한다.
 * 그래서 대부분은 **계약 모양에 가까운** 봉투를 만들고 값만 흔든다: 진짜 타입 이름, 진짜
 * 방 코드, 그럴듯한 payload 키에 경계값(0·음수·2^53·빈 문자열·거대 문자열·`__proto__`)을
 * 섞는다. 일부만 아예 깨진 텍스트다.
 */
export interface FuzzContext {
  readonly roomId: string
  readonly playerIds: readonly string[]
}

const NUMBERS = [
  0,
  -1,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  12,
  13,
  0.5,
  -0.5,
  1e9,
  -1e9,
  2 ** 31,
  2 ** 53,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
]

const STRINGS = [
  '',
  ' ',
  'a',
  'left',
  'right',
  'like',
  'gg',
  'YACHT_DICE',
  '__proto__',
  'constructor',
  'toString',
  '😀🎲',
  '\u0000',
  '\u202e',
  'null',
  '<script>',
  "'; DROP TABLE users; --",
  'x'.repeat(201),
  'y'.repeat(5_000),
  ...YACHT_CATEGORIES,
]

const KEYS = [
  'roundNumber',
  'rollCount',
  'held',
  'dice',
  'category',
  'text',
  'ready',
  'reaction',
  'to',
  'data',
  'roomId',
  'sessionToken',
  'nickname',
  'direction',
  'strength',
  'playerId',
  'index',
  'value',
  'state',
  '__proto__',
  'constructor',
]

const TYPE_MUTATIONS = [
  '',
  'game.',
  'game.yacht_dice.',
  'game.unknown.dice.roll',
  'GAME.YACHT_DICE.DICE.ROLL',
  'room',
  'sys.',
  't'.repeat(300),
]

const GARBAGE = [
  '',
  ' ',
  'null',
  'true',
  '42',
  '"text"',
  '[]',
  '{}',
  '{',
  '}',
  '{"type":',
  'not json',
  '\u0000',
  '{"type":"sys.ping"',
  `${'['.repeat(1_000)}${']'.repeat(1_000)}`,
  `{"type":"chat.send","ts":1,"payload":${'{"a":'.repeat(500)}1${'}'.repeat(500)}}`,
]

/** `__proto__`도 **자기 속성**으로 싣는다 — 대입하면 프로토타입이 바뀌어 JSON에서 빠진다. */
const setOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

const dieLike = (random: Prng): number => random.int(0, 7)

/** 모듈 핸들러가 실제로 읽는 키를 갖춘, 경계 근처의 payload. */
const plausiblePayload = (random: Prng, context: FuzzContext): Record<string, unknown> => ({
  roundNumber: random.chance(0.7) ? random.int(0, 14) : random.pick(NUMBERS),
  rollCount: random.chance(0.8) ? random.int(0, 4) : random.pick(NUMBERS),
  held: Array.from({ length: random.chance(0.8) ? 5 : random.int(0, 7) }, () =>
    random.chance(0.9) ? random.chance(0.4) : random.pick(STRINGS),
  ),
  dice: Array.from({ length: random.chance(0.8) ? 5 : random.int(0, 7) }, () => dieLike(random)),
  category: random.pick(STRINGS),
  text: random.pick(STRINGS),
  ready: random.chance(0.5),
  reaction: random.pick(STRINGS),
  to: random.pick([...context.playerIds, 'nobody']),
  data: { sdp: random.pick(STRINGS) },
})

export const randomValue = (random: Prng, context: FuzzContext, depth = 0): unknown => {
  switch (random.int(0, depth >= 3 ? 5 : 8)) {
    case 0:
      return null
    case 1:
      return random.chance(0.5)
    case 2:
      return random.pick(NUMBERS)
    case 3:
      return random.int(-10, 100)
    case 4:
      return random.pick(STRINGS)
    case 5:
      return random.pick([context.roomId, ...context.playerIds])
    case 6:
      return Array.from({ length: random.int(0, 6) }, () => randomValue(random, context, depth + 1))
    case 7: {
      const object: Record<string, unknown> = {}
      for (let count = random.int(0, 5); count > 0; count -= 1) {
        setOwn(object, random.pick(KEYS), randomValue(random, context, depth + 1))
      }
      return object
    }
    default:
      return plausiblePayload(random, context)
  }
}

/** 프레임 하나(텍스트). 대부분은 봉투 모양이고 일부는 깨진 텍스트다. */
export const randomFrame = (random: Prng, context: FuzzContext): string => {
  const shape = random.next()
  if (shape < 0.08) return random.pick(GARBAGE)
  if (shape < 0.14) return JSON.stringify(randomValue(random, context)) ?? 'null'

  const envelope: Record<string, unknown> = {}
  setOwn(
    envelope,
    'type',
    random.chance(0.9)
      ? random.pick(CLIENT_MESSAGE_TYPES)
      : random.chance(0.5)
        ? random.pick(TYPE_MUTATIONS)
        : randomValue(random, context),
  )
  setOwn(envelope, 'ts', random.chance(0.95) ? Date.now() : randomValue(random, context))
  setOwn(
    envelope,
    'payload',
    random.chance(0.7) ? plausiblePayload(random, context) : randomValue(random, context),
  )
  if (random.chance(0.85)) {
    setOwn(envelope, 'roomId', random.chance(0.85) ? context.roomId : randomValue(random, context))
  }
  if (random.chance(0.8)) {
    setOwn(
      envelope,
      'msgId',
      random.chance(0.9) ? `fz-${random.int(0, 999_999)}` : randomValue(random, context),
    )
  }
  return JSON.stringify(envelope)
}
