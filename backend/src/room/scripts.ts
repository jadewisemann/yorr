import type { LuaScript } from '../infra/lua.js'

/**
 * 방 상태 전이 Lua. 반환 코드가 곧 계약이므로 조건 순서를 바꾸지 않는다
 * (docs/design/rooms-and-sessions.md 「Lua 스크립트」).
 *
 * CLOSE·TOUCH는 참가자 수가 가변이라 게임 키 이름을 스크립트 안에서 조립한다 —
 * **단일 Redis 노드 전제**(클러스터로 가면 참가자별 삭제를 애플리케이션으로 올려야 한다).
 */

/** KEYS: room / ARGV: capacity, hostId, gameCode, ttlSeconds, mode → 0 충돌(재시도) · 1 생성 */
export const CREATE: LuaScript = {
  name: 'yorrRoomCreate',
  numberOfKeys: 1,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'capacity', ARGV[1], 'members', '0', 'phase', 'LOBBY',
    'hostId', ARGV[2], 'gameCode', ARGV[3], 'mode', ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`,
}

/**
 * KEYS: room, players, scores, bots / ARGV: userId, nickname
 * → 0 없음 · 2 시작됨 · 3 정원 · 4 중복(호출부 미처리 = 성공 취급, 단 TTL 정렬은 건너뛴다) · 1 참가
 *
 * 들어오면서 **주인 없는 방의 방장을 이어받는다** — 파티 방의 대시보드는 명단에
 * 없고, 방장이 나간 방은 hostId가 비어 있다. 둘 다 "다음에 들어온 사람이 방장"으로 풀린다.
 */
export const JOIN: LuaScript = {
  name: 'yorrRoomJoin',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return 4 end
if redis.call('HLEN', KEYS[2]) >= tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 3 end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[3], ARGV[1], '0')
redis.call('HINCRBY', KEYS[1], 'members', 1)
local host = redis.call('HGET', KEYS[1], 'hostId')
if not host or host == '' or redis.call('HEXISTS', KEYS[2], host) == 0 then
    redis.call('HSET', KEYS[1], 'hostId', ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
    redis.call('PEXPIRE', KEYS[2], ttl)
    redis.call('PEXPIRE', KEYS[3], ttl)
    if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
end
return 1
`,
}

/**
 * KEYS: room, players, scores, bots / ARGV: playerId
 * → -1 방·좌석 없음 · 0 방이 삭제됨 · 1 잔류
 *
 * 방 삭제는 **파티 방만 예외**다(대시보드는 members에 세어지지 않아 컨트롤러 하나가
 * 들어왔다 나가는 것만으로 QR을 띄운 방이 사라진다). 방장 승계는 두 모드 공통이고
 * 후보는 **사람만** — 봇에게 넘기면 아무도 조작할 수 없다. 참가자가 hash라 입장
 * 순서가 없으므로 **누가 실행해도 같은 결과**인 playerId 오름차순 첫 번째를 쓴다.
 */
export const LEAVE: LuaScript = {
  name: 'yorrRoomLeave',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if redis.call('HDEL', KEYS[2], ARGV[1]) == 0 then return -1 end
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('HDEL', KEYS[4], ARGV[1])
local members = redis.call('HINCRBY', KEYS[1], 'members', -1)
if members <= 0 and redis.call('HGET', KEYS[1], 'mode') ~= 'PARTY' then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    redis.call('DEL', KEYS[3])
    redis.call('DEL', KEYS[4])
    return 0
end
if redis.call('HGET', KEYS[1], 'hostId') == ARGV[1] then
    local heir = ''
    local remaining = redis.call('HKEYS', KEYS[2])
    table.sort(remaining)
    for i = 1, #remaining do
        if redis.call('HEXISTS', KEYS[4], remaining[i]) == 0 then
            heir = remaining[i]
            break
        end
    end
    redis.call('HSET', KEYS[1], 'hostId', heir)
end
return 1
`,
}

/** KEYS: room, players, scores, bots → 항상 1(멱등). 게임 키까지 지운다. */
export const CLOSE: LuaScript = {
  name: 'yorrRoomClose',
  numberOfKeys: 4,
  lua: `
local gameId = redis.call('HGET', KEYS[1], 'gameId')
if gameId then
    local players = redis.call('HKEYS', KEYS[2])
    for i = 1, #players do
        redis.call('DEL', 'game:' .. gameId .. ':scoreboard:' .. players[i])
        redis.call('DEL', 'game:' .. gameId .. ':score-submissions:' .. players[i])
    end
    redis.call('DEL', 'game:' .. gameId)
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
return 1
`,
}

/**
 * KEYS: room, players, scores, bots / ARGV: ttlSeconds → 0 방 없음 · 1
 *
 * 활동 시각 갱신(sliding TTL). 이게 없으면 TTL이 "생성 후 40분"이라 활발히
 * 플레이 중인 방도 정해진 시각에 사라지고, 남은 사람은 계속 노는데 신규 참가만
 * 404가 나는 상태가 된다.
 */
export const TOUCH: LuaScript = {
  name: 'yorrRoomTouch',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 1 end
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('PEXPIRE', KEYS[3], ttl)
if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
local gameId = redis.call('HGET', KEYS[1], 'gameId')
if gameId then
    redis.call('PEXPIRE', 'game:' .. gameId, ttl)
    local players = redis.call('HKEYS', KEYS[2])
    for i = 1, #players do
        redis.call('PEXPIRE', 'game:' .. gameId .. ':scoreboard:' .. players[i], ttl)
        redis.call('PEXPIRE', 'game:' .. gameId .. ':score-submissions:' .. players[i], ttl)
    end
end
return 1
`,
}

/**
 * KEYS: room, players, game, bots / ARGV: gameId, roomCode, minPlayers → 0(모든 실패) · 1
 *
 * **실패 사유 구분 불가가 계약이다** — 호출부는 전부 `game_not_ready`로 뭉갠다.
 * 인원 검사는 `HLEN players`라 봇도 정원을 채운다.
 */
export const START: LuaScript = {
  name: 'yorrRoomStart',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 0 end
if redis.call('HLEN', KEYS[2]) < tonumber(ARGV[3]) then return 0 end
local gameCode = redis.call('HGET', KEYS[1], 'gameCode')
if not gameCode then return 0 end
redis.call('HSET', KEYS[1], 'phase', 'PLAYING', 'gameId', ARGV[1])
redis.call('HSET', KEYS[3], 'roomCode', ARGV[2], 'gameCode', gameCode)
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
    redis.call('PEXPIRE', KEYS[3], ttl)
    if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
end
return 1
`,
}

/**
 * KEYS: room, game / ARGV: gameId → 0 · 1
 *
 * 모듈 초기화가 실패했을 때 **자기 게임만** 되돌린다 — gameId가 일치할 때만.
 */
export const ROLLBACK_START: LuaScript = {
  name: 'yorrRoomRollbackStart',
  numberOfKeys: 2,
  lua: `
if redis.call('HGET', KEYS[1], 'phase') ~= 'PLAYING' then return 0 end
if redis.call('HGET', KEYS[1], 'gameId') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'phase', 'LOBBY')
redis.call('HDEL', KEYS[1], 'gameId')
redis.call('DEL', KEYS[2])
return 1
`,
}

/**
 * KEYS: room → 0 · 1
 *
 * 본 경기 전 준비 단계가 취소됐을 때 방을 다시 대기실로 연다. gameId를 인자로
 * 받지 않는 이유는 준비 중 이탈 경로가 방 코드만 알고 있기 때문이다.
 */
export const CANCEL_ACTIVE_GAME: LuaScript = {
  name: 'yorrRoomCancelActiveGame',
  numberOfKeys: 1,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'PLAYING' then return 0 end
local gameId = redis.call('HGET', KEYS[1], 'gameId')
redis.call('HSET', KEYS[1], 'phase', 'LOBBY')
redis.call('HDEL', KEYS[1], 'gameId')
if gameId then redis.call('DEL', 'game:' .. gameId) end
return 1
`,
}

/**
 * KEYS: room, players, scores, bots → 0(FINISHED 아님) · 1
 *
 * 총점 해시(scores)를 0으로 되돌리는 게 핵심이다 — 이건 gameId가 아니라 방에
 * 매달려 있어서 초기화하지 않으면 다음 게임 순위에 지난 게임 점수가 얹힌다.
 * 점수판(`game:{id}:scoreboard:*`)은 결과 조회용으로 남긴다.
 */
export const RETURN_TO_LOBBY: LuaScript = {
  name: 'yorrRoomReturnToLobby',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'FINISHED' then return 0 end
redis.call('HSET', KEYS[1], 'phase', 'LOBBY')
redis.call('HDEL', KEYS[1], 'gameId')
local players = redis.call('HKEYS', KEYS[2])
for i = 1, #players do
    redis.call('HSET', KEYS[3], players[i], '0')
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
    redis.call('PEXPIRE', KEYS[3], ttl)
    if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
end
return 1
`,
}

/**
 * KEYS: room, players, scores, bots / ARGV: requesterId, botId, nickname, 'BOT'
 * → 0 방 없음 · 2 대기실 아님 · 3 호스트 아님 · 4 정원 · 5 botId 중복 · 1 추가
 *
 * 호스트 판정이 **hostId 일치 + 명단 존재**의 두 조건인 것은 방 조작 API 공통
 * 규약이다 — 방을 떠난 옛 호스트가 남의 방에 봇을 붙이지 못한다. 파티 방도
 * 같다: 방장은 처음 들어온 컨트롤러라 hostId는 항상 명단 안을 가리킨다.
 *
 * 검증을 전부 통과한 뒤에야 세 키(players·scores·bots)를 함께 쓴다 — 봇 행은
 * 사람 행과 같은 정규 행이고, `bots` 해시만이 "이 행은 봇"의 유일한 근거다.
 */
export const BOT_ADD: LuaScript = {
  name: 'yorrRoomBotAdd',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
if redis.call('HGET', KEYS[1], 'hostId') ~= ARGV[1] then return 3 end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 3 end
if redis.call('HLEN', KEYS[2]) >= tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 4 end
if redis.call('HEXISTS', KEYS[2], ARGV[2]) == 1 then return 5 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('HSET', KEYS[3], ARGV[2], '0')
redis.call('HSET', KEYS[4], ARGV[2], ARGV[4])
redis.call('HINCRBY', KEYS[1], 'members', 1)
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
    redis.call('PEXPIRE', KEYS[2], ttl)
    redis.call('PEXPIRE', KEYS[3], ttl)
    redis.call('PEXPIRE', KEYS[4], ttl)
end
return 1
`,
}

/**
 * KEYS: room, players, scores, bots / ARGV: requesterId, botId
 * → 0 방 없음 · 2 대기실 아님 · 3 호스트 아님 · 4 봇 없음 · 1 삭제
 *
 * **bots 해시에서 HDEL이 성공해야만** 명단·점수를 지운다 — 이 API로 사람을
 * 쫓아낼 수 없게 하는 조건이다(권한 검사가 아니라 대상 검사).
 */
export const BOT_REMOVE: LuaScript = {
  name: 'yorrRoomBotRemove',
  numberOfKeys: 4,
  lua: `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
if redis.call('HGET', KEYS[1], 'hostId') ~= ARGV[1] then return 3 end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 3 end
if redis.call('HDEL', KEYS[4], ARGV[2]) == 0 then return 4 end
redis.call('HDEL', KEYS[2], ARGV[2])
redis.call('HDEL', KEYS[3], ARGV[2])
redis.call('HINCRBY', KEYS[1], 'members', -1)
return 1
`,
}

/** 봇 참가자 스크립트 — `BotParticipantService`가 등록한다. */
export const BOT_SCRIPTS: readonly LuaScript[] = [BOT_ADD, BOT_REMOVE]

export const ROOM_SCRIPTS: readonly LuaScript[] = [
  CREATE,
  JOIN,
  LEAVE,
  CLOSE,
  TOUCH,
  START,
  ROLLBACK_START,
  CANCEL_ACTIVE_GAME,
  RETURN_TO_LOBBY,
  ...BOT_SCRIPTS,
]
