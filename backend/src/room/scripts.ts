/**
 * 방 상태 전이 스크립트의 배럴. 무리별 파일에 있고, 여기서는 이름만 다시 내보낸다.
 *
 * - [`lifecycle`](./scripts/lifecycle.ts) — 생성·참가·이탈·폐쇄
 * - [`expiry`](./scripts/expiry.ts) — 슬라이딩 TTL 갱신
 * - [`gameFlow`](./scripts/gameFlow.ts) — 시작·되돌리기·대기실 복귀
 * - [`bots`](./scripts/bots.ts) — 대기실 봇 추가·삭제
 *
 * 반환 코드가 곧 계약이므로 각 스크립트의 조건 순서를 바꾸지 않는다
 * (docs/design/rooms-and-sessions.md 「원자적 스크립트」).
 */
export { BOT_ADD, BOT_REMOVE } from './scripts/bots.js'
export { TOUCH } from './scripts/expiry.js'
export {
  CANCEL_ACTIVE_GAME,
  RETURN_TO_LOBBY,
  ROLLBACK_START,
  START,
} from './scripts/gameFlow.js'
export { CLOSE, CREATE, JOIN, LEAVE } from './scripts/lifecycle.js'
