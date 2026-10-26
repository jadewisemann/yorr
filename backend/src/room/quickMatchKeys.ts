import { roomKey } from './keys.js'

/**
 * 퀵매치의 Redis 키와 시간 상수 — 서비스·러너·라우트가 공유하는 이름.
 *
 * 한 파일에 모은 이유: 키 이름은 **계약**이다. `UserService.clearRoom`이 티켓 키를
 * 직접 지우고, 라우트 테스트가 방 마커를 직접 읽는다. 흩어 두면 철자를 고칠 때
 * 조용히 계약이 깨진다.
 */

/** 대기 티켓·큐 잔류 시간. 이 시간을 넘긴 대기자는 매칭 시도마다 점수 윈도로 청소된다. */
export const QUICK_MATCH_WAIT_TTL_SECONDS = 5 * 60

/** 게임 코드별 매칭 락의 수명. 매칭 한 번(방 생성 + join N회)보다 넉넉하다. */
export const QUICK_MATCH_LOCK_TTL_SECONDS = 5

/** ZSET 점수는 enqueue 시각(ms)이다 — 오름차순 = 오래 기다린 순. */
export const quickMatchQueueKey = (gameCode: string): string => `quick-match:queue:${gameCode}`

/**
 * 사용자당 티켓 하나. **`UserService.clearRoom`이 이 키를 지운다**(방을 떠나면
 * 티켓도 사라진다) — 그 규약이 이미 1.2에 이식돼 있으므로 키 이름을 바꿀 수 없다.
 */
export const quickMatchTicketKey = (userId: string): string => `quick-match:user:${userId}`

export const quickMatchLockKey = (gameCode: string): string => `quick-match:lock:${gameCode}`

/** 방에 붙는 "전원 접속 시 자동 시작" 마커. 시작하거나 이미 시작됐으면 지운다. */
export const quickMatchMarkerKey = (roomCode: string): string => `${roomKey(roomCode)}:quick-match`
