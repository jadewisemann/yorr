/**
 * 블랙박스 스위트가 기대는 와이어 계약의 **최소 사본**. 정본은
 * `frontend/src/realtime/wsEvents.ts`다(backend/AGENTS.md). 여기 목록이 서버와 어긋나면
 * 퍼저가 "모르는 오류 코드"로 실패한다 — 계약이 넓어졌으면 이 사본과 정본을 함께 고친다.
 */
export const WS_ERROR_CODES = [
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'SESSION_EXPIRED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'NOT_IN_ROOM',
  'ALREADY_IN_ROOM',
  'GAME_ALREADY_STARTED',
  'NOT_YOUR_TURN',
  'INVALID_MESSAGE',
  'RATE_LIMITED',
  'INTERNAL',
] as const

/** 클라이언트 → 서버 타입 전부(wsEvents.ts의 ClientMessage). 퍼저가 여기서 고른다. */
export const CLIENT_MESSAGE_TYPES = [
  'sys.ping',
  'sys.reconnect',
  'room.join',
  'room.leave',
  'room.ready',
  'reaction.send',
  'chat.send',
  'ctrl.signal',
  'game.ping_pong.host_state',
  'game.ping_pong.swing',
  'game.ping_pong.ready',
  'game.yacht_dice.dice.roll',
  'game.yacht_dice.dice.hold',
  'game.yacht_dice.dice.shake',
  'game.yacht_dice.dice.throw',
  'game.yacht_dice.round.submit',
  'game.duel.draw',
  'game.davinci_code.guess',
  'game.davinci_code.decide',
  'game.davinci_code.place',
] as const

/** 계약 상수 — 경계값 테스트가 양쪽(안쪽·바깥쪽)을 찌른다. 출처는 옆 주석. */
export const LIMITS = {
  /** `user/session.ts` NICKNAME_MAX_LENGTH */
  nicknameMax: 20,
  /** `ws/protocol.ts` CHAT_TEXT_MAX_LENGTH */
  chatTextMax: 200,
  /** `ws/chat.ts` CHAT_RATE_LIMIT (10초 창) */
  chatBurst: 10,
  /** `ws/protocol.ts` WS_MAX_MESSAGE_BYTES */
  wsMessageBytes: 64 * 1024,
  /** `game/catalog.ts` YACHT_DICE 정원 */
  yachtCapacity: 6,
} as const
