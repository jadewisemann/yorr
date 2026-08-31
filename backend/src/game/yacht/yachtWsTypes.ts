import { YACHT_DICE } from '../catalog.js'
import { gameWsType } from '../module.js'

/**
 * 야추 WS 타입 조립.
 *
 * 접두사 규칙(`game.<code소문자>.<event>`)의 소유자는 `game/module.ts`의
 * `gameWsType`이다. 여기서 문자열을 다시 만들지 않고 코드만 고정한다.
 */
export const yachtWsType = (eventType: string): string => gameWsType(YACHT_DICE, eventType)

/**
 * 이 모듈이 받는 인바운드 이벤트(접두사가 벗겨진 이름). 이 목록 밖은
 * 레지스트리 `dispatch`가 `false`를 돌려주고 게이트웨이가 `INVALID_MESSAGE`로 답한다.
 */
export const YACHT_INBOUND_EVENTS = [
  'dice.roll',
  'dice.hold',
  'dice.shake',
  'dice.throw',
  'round.submit',
] as const

export type YachtInboundEvent = (typeof YACHT_INBOUND_EVENTS)[number]

const INBOUND: ReadonlySet<string> = new Set(YACHT_INBOUND_EVENTS)

export const isYachtInboundEvent = (eventType: string): eventType is YachtInboundEvent =>
  INBOUND.has(eventType)
