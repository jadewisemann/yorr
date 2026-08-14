import type { LuaScript } from '../../infra/lua.js'

/**
 * 점수 확정 Lua — backend-java `RedisScoreBoardStore.CONFIRM_SCORE`에서
 * **텍스트 그대로** 옮겼다. 반환 코드가 곧 계약이므로 가드 사다리의 **순서도**
 * 바꾸지 않는다(DESIGN.md 원칙 7, docs/design/game-modules.md 「CONFIRM_SCORE Lua」).
 *
 * KEYS
 * | # | 키 | 용도 |
 * |---|---|---|
 * | 1 | `game:{gameId}` | 게임→방 매핑, TTL의 기준 |
 * | 2 | `room:{roomCode}` | phase·gameId 역매핑 |
 * | 3 | `room:{roomCode}:players` | roster(봇 포함) |
 * | 4 | `game:{gameId}:scoreboard:{playerId}` | 카테고리 12칸 + `_` 접두 메타 3필드 |
 * | 5 | `game:{gameId}:score-submissions:{playerId}` | 라운드→요청 시그니처 |
 * | 6 | `room:{roomCode}:scores` | 방 누적 총점(순위 계산의 입력) |
 *
 * ARGV: 1 roomCode · 2 gameId · 3 playerId · 4 roundNumber · 5 categoryApiKey
 *       · 6 score · 7 상단이면 '1' · 8 requestSignature
 *
 * 반환 코드 10종 (→ `ScoreConfirmationError.reason`)
 * | 코드 | 의미 | reason |
 * |---|---|---|
 * | 0 | 성공 | — |
 * | 1 | `game:{id}`에 roomCode 없음 | `GAME_NOT_FOUND` |
 * | 2 | game→room 매핑이 인자와 불일치 | `GAME_NOT_FOUND` |
 * | 3 | roster에 없는 플레이어 | `PLAYER_NOT_IN_GAME` |
 * | 4 | 같은 라운드·**다른** 시그니처 | `ROUND_ALREADY_SCORED` |
 * | 5 | 같은 라운드·**같은** 시그니처 | 멱등 재시도 — **성공 취급**(점수 이중 반영 없음) |
 * | 6 | 카테고리 이미 사용 | `CATEGORY_ALREADY_USED` |
 * | 7 | room 키 없음 | `GAME_NOT_FOUND` |
 * | 8 | room의 gameId가 인자와 불일치 | `GAME_NOT_FOUND` |
 * | 9 | phase ≠ PLAYING | `GAME_NOT_ACTIVE` |
 *
 * - 1·2·7·8이 **양방향** 매핑 검증이다: 오래된 gameId로 현재 방의 점수를 바꾸는
 *   경로를 막는다. roomCode 사전 조회는 스크립트 밖이라 스테일일 수 있지만,
 *   그 경우 가드 8이 잡는다.
 * - 시그니처는 `category:d1,d2,d3,d4,d5`라 **주사위 순서에 민감**하다. 재정렬된
 *   재시도는 5가 아니라 4로 거부된다(quirk이자 계약 — 그대로 옮긴다).
 * - 집계는 스크립트 안에서 끝낸다: 상단이면 소계 가산 → `보너스 = 소계>=63 ? 35 : 0`
 *   → `총점 = 총점 + 점수 + 새보너스 - 이전보너스`(보너스 이중 지급 방지).
 * - TTL은 `game:{id}`의 PTTL로 점수판·제출 이력을 정렬한다. 방 키 가족이 함께
 *   만료돼야 반쪽 상태가 남지 않는다.
 */
export const CONFIRM_SCORE: LuaScript = {
  name: 'yorrGameConfirmScore',
  numberOfKeys: 6,
  lua: `
local mappedRoom = redis.call('HGET', KEYS[1], 'roomCode')
if not mappedRoom then return 1 end
if mappedRoom ~= ARGV[1] then return 2 end
if redis.call('EXISTS', KEYS[2]) == 0 then return 7 end
if redis.call('HGET', KEYS[2], 'gameId') ~= ARGV[2] then return 8 end
if redis.call('HGET', KEYS[2], 'phase') ~= 'PLAYING' then return 9 end
if redis.call('HEXISTS', KEYS[3], ARGV[3]) == 0 then return 3 end

local previous = redis.call('HGET', KEYS[5], ARGV[4])
if previous then
    if previous == ARGV[8] then return 5 end
    return 4
end
if redis.call('HEXISTS', KEYS[4], ARGV[5]) == 1 then return 6 end

local score = tonumber(ARGV[6])
local upperSubtotal = tonumber(redis.call('HGET', KEYS[4], '_upperSubtotal') or '0')
local upperBonus = tonumber(redis.call('HGET', KEYS[4], '_upperBonus') or '0')
local total = tonumber(redis.call('HGET', KEYS[4], '_total') or '0')

if ARGV[7] == '1' then
    upperSubtotal = upperSubtotal + score
end
local nextBonus = 0
if upperSubtotal >= 63 then nextBonus = 35 end
total = total + score + nextBonus - upperBonus

redis.call('HSET', KEYS[4],
    ARGV[5], ARGV[6],
    '_upperSubtotal', tostring(upperSubtotal),
    '_upperBonus', tostring(nextBonus),
    '_total', tostring(total))
redis.call('HSET', KEYS[5], ARGV[4], ARGV[8])
redis.call('HSET', KEYS[6], ARGV[3], tostring(total))

local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
    redis.call('PEXPIRE', KEYS[4], ttl)
    redis.call('PEXPIRE', KEYS[5], ttl)
end
return 0
`,
}

/** 이 하위 시스템이 등록하는 스크립트 전부. */
export const SCORE_SCRIPTS: readonly LuaScript[] = [CONFIRM_SCORE]

/** 반환 코드 상수 — 스토어가 이유 코드로 옮길 때 쓴다(숫자 리터럴 금지). */
export const CONFIRM_SCORE_CODE = {
  SUCCESS: 0,
  GAME_MISSING: 1,
  GAME_ROOM_CHANGED: 2,
  PLAYER_MISSING: 3,
  ROUND_CONFLICT: 4,
  IDEMPOTENT_RETRY: 5,
  CATEGORY_CONFLICT: 6,
  ROOM_MISSING: 7,
  ROOM_GAME_CHANGED: 8,
  GAME_NOT_PLAYING: 9,
} as const
