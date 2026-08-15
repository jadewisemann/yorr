import type { LuaScript } from '../../infra/lua.js'

/**
 * 게임 종료 전이 Lua. 판정과 전이가 한 연산이어야 `game.over`가 정확히 한 번
 * 나간다(docs/design/game-modules.md 「게임 종료」).
 *
 * KEYS
 * | # | 키 | 용도 |
 * |---|---|---|
 * | 1 | `room:{roomCode}` | phase·gameId — 판정 대상이자 전이 대상 |
 * | 2 | `room:{roomCode}:players` | roster(봇 포함). 여기 있는 전원의 점수판을 센다 |
 *
 * ARGV: 1 gameId · 2 force('1'이면 완료 검사 생략) · 3 필요한 기록 칸 수(12)
 *
 * 반환 코드
 * | 코드 | 의미 |
 * |---|---|
 * | 0 | 전이하지 않았다 — 방 없음 / phase≠PLAYING(이미 누가 끝냈다) / gameId 불일치(스테일) / roster 빈 방 / 누군가 점수판이 덜 찼다 |
 * | 1 | **이 호출이** PLAYING → FINISHED로 바꿨다. 방송할 자격은 이 호출에만 있다 |
 *
 * - 0이 "실패"가 아니라 "내가 한 게 아니다"까지 포함한다. 사유를 나누지 않는다 —
 *   호출자가 할 일(방송 안 함)이 모든 0에서 같기 때문이다.
 * - 점수판 키는 **스크립트 안에서 조립한다**(참가자 수가 가변이라 KEYS로 못 넘긴다).
 *   `room/keys.ts`의 `gameScoreboardKey`와 같은 이름이어야 하고, 단일 Redis 노드
 *   전제다. 클러스터로 가면 참가자별 조회를 애플리케이션으로 올려야 한다.
 * - 완료는 "`_` 비접두 필드 개수 ≥ 12"로 센다. 점수판 해시의 집계 3필드는
 *   `_upperSubtotal`·`_upperBonus`·`_total`(`score/scoreBoardMapper.ts`의 상수)이라
 *   접두사만 보면 걸러진다. **접두 없는 메타 필드를 추가하면 게임이 일찍 끝난다.**
 * - `force='1'`은 라운드 상한 도달(타임아웃으로 빈 칸이 남아도 끝내는 안전망)과
 *   duel·pingpong(자체 종료 판정)이 쓴다.
 */
export const FINISH_IF_COMPLETE: LuaScript = {
  name: 'yorrGameFinishIfComplete',
  numberOfKeys: 2,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'PLAYING' then return 0 end
if redis.call('HGET', KEYS[1], 'gameId') ~= ARGV[1] then return 0 end

if ARGV[2] ~= '1' then
    local players = redis.call('HKEYS', KEYS[2])
    if #players == 0 then return 0 end
    for i = 1, #players do
        local fields = redis.call('HKEYS', 'game:' .. ARGV[1] .. ':scoreboard:' .. players[i])
        local recorded = 0
        for j = 1, #fields do
            if string.sub(fields[j], 1, 1) ~= '_' then recorded = recorded + 1 end
        end
        if recorded < tonumber(ARGV[3]) then return 0 end
    end
end

redis.call('HSET', KEYS[1], 'phase', 'FINISHED')
return 1
`,
}

/** 이 하위 시스템이 등록하는 스크립트 전부. */
export const COMPLETION_SCRIPTS: readonly LuaScript[] = [FINISH_IF_COMPLETE]

/** 반환 코드 상수 — 숫자 리터럴로 비교하지 않는다. */
export const FINISH_IF_COMPLETE_CODE = {
  /** 전이하지 않았다(사유 불문). */
  NOT_FINISHED: 0,
  /** 이 호출이 전이를 수행했다. */
  FINISHED_BY_THIS_CALL: 1,
} as const
