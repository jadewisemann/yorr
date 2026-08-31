import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { CodedError, ConflictError, DomainError } from '../errors.js'
import { registerLuaScripts, runLuaNumber } from '../infra/lua.js'
import { roomKeyFamily } from './keys.js'
import type { RoomService } from './roomService.js'
import { BOT_ADD, BOT_REMOVE, BOT_SCRIPTS } from './scripts.js'
import type { RoomSnapshot } from './snapshot.js'

/**
 * Java `SecurityException` 자리 — REST **403**.
 *
 * `DomainError`(400/404)·`ConflictError`(409)와 섞이면 상태 코드가 조용히
 * 바뀌므로 따로 둔다. 지금 이 코드를 던지는 곳은 봇 API뿐이라 여기에 있다 —
 * 다른 API가 쓰기 시작하면 `errors.ts`로 올린다.
 */
export class ForbiddenError extends CodedError {}

const BOT_ID_PREFIX = 'bot-'
const BOT_MARKER = 'BOT'

/** `bot-<uuid>` — 끝 4자를 대문자로 붙인 표시 이름까지 Java와 같은 규칙이다. */
const newBotId = (): string => `${BOT_ID_PREFIX}${randomUUID()}`

const botNickname = (botId: string): string => `요르봇 ${botId.slice(-4).toUpperCase()}`

/**
 * 대기실 AI 봇 참가자.
 *
 * 봇은 roster·scores의 **정규 행**이라 정원과 START의 minPlayers를 그대로
 * 채운다. `room:{code}:bots` 해시가 "이 행은 봇"이라는 유일한 마커이자 삭제
 * 권한의 근거다(docs/design/rooms-and-sessions.md 「봇」).
 *
 * 호스트·대기실·정원 검증은 전부 Lua 안에 있다 — 여기서 미리 읽고 판단하면
 * 읽기와 쓰기 사이에 방이 시작되는 경합이 생긴다.
 */
export class BotParticipantService {
  constructor(
    private readonly redis: Redis,
    private readonly rooms: RoomService,
  ) {
    registerLuaScripts(redis, BOT_SCRIPTS)
  }

  async add(roomCode: string, requesterId: string): Promise<RoomSnapshot> {
    const botId = newBotId()
    const result = await runLuaNumber(this.redis, BOT_ADD, roomKeyFamily(roomCode), [
      requesterId,
      botId,
      botNickname(botId),
      BOT_MARKER,
    ])
    requireSuccess(result, false)
    return this.rooms.getSnapshot(roomCode)
  }

  async remove(roomCode: string, requesterId: string, botId: string): Promise<RoomSnapshot> {
    const result = await runLuaNumber(this.redis, BOT_REMOVE, roomKeyFamily(roomCode), [
      requesterId,
      botId,
    ])
    requireSuccess(result, true)
    return this.rooms.getSnapshot(roomCode)
  }
}

/**
 * 반환 코드 → 오류 코드. **4의 뜻이 두 스크립트에서 다르다**(추가=정원 초과,
 * 삭제=그런 봇 없음) — Java의 `botMustExist` 분기를 그대로 옮겼다.
 */
const requireSuccess = (result: number, botMustExist: boolean): void => {
  if (result === 1) return
  if (result === 0) throw new DomainError('room_not_found')
  if (result === 2) throw new ConflictError('lobby_only')
  if (result === 3) throw new ForbiddenError('host_only')
  if (result === 4) throw new ConflictError(botMustExist ? 'bot_not_found' : 'room_full')
  // 5(botId 중복)와 알 수 없는 코드. UUID가 겹치는 일은 사실상 없지만 계약은 계약이다.
  throw new ConflictError('bot_operation_failed')
}
