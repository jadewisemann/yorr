import type { Redis } from 'ioredis'
import { afterAll, beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { loadEnv } from '../../../config/env.js'
import { playersKey, roomKey } from '../../../room/keys.js'
import { RoomService } from '../../../room/roomService.js'
import { createServer, type YorrServer } from '../../../server.js'
import { UserService } from '../../../user/session.js'
import { SOCKET_OPEN } from '../../../ws/socket.js'

interface EnterRoomResponse {
  id: string
  nickname: string
  token: string
  room_id: string
  game_code: string | null
}

const enterRoom = async (
  server: YorrServer,
  body: Record<string, unknown>,
  query = '',
): Promise<{ statusCode: number; body: string; json: EnterRoomResponse }> => {
  const response = await server.app.inject({
    method: 'POST',
    url: `/api/v1/rooms${query}`,
    payload: body,
  })
  return {
    statusCode: response.statusCode,
    body: response.body,
    json: response.statusCode === 200 ? (response.json() as EnterRoomResponse) : ({} as never),
  }
}

const authHeaders = (userId: string, token: string): Record<string, string> => ({
  'X-User-Id': userId,
  Authorization: `Bearer ${token}`,
})

/**
 * REST로 게임을 시작하기 전에 그 사람의 자리를 WS 레지스트리에 올린다.
 *
 * 실전 프론트는 `room.join`(WS)을 먼저 하고 **그다음** REST로 게임을 시작한다.
 * 레지스트리에 없으면 라운드 타이머가 첫 턴 주인을 오프라인으로 판정하고, 1인
 * 방에서는 `MAX_OFFLINE_TURNS`(2)에 즉시 닿아 그 사람이 자동 퇴장하고 마지막
 * 참가자 퇴장으로 방까지 지워진다(2.5의 계약이며 Java와 같다). 게임 모듈이
 * 배선되기 전에는 `POST /games`가 phase만 옮겼기 때문에 이 자리가 필요 없었다.
 *
 * `ws`의 WebSocket 대신 전송을 버리는 가짜를 넣는다 — 이 스위트는 `app.inject()`로
 * 돌고 실제 소켓을 열지 않는다(소켓 위 검증은 `ws/__tests__/gateway.test.ts`).
 */
const attachPresence = (server: YorrServer, roomCode: string, user: EnterRoomResponse): void => {
  server.registry.join(
    roomCode,
    { readyState: SOCKET_OPEN, send: () => {}, close: () => {} },
    user.id,
    user.nickname,
  )
}

describeRedis('방 REST', () => {
  const redis = useRedis()
  let server: YorrServer

  beforeEach(async () => {
    if (server) await server.close()
    server = await createServer(loadEnv({ CORS_ALLOWED_ORIGINS: '*' }), {
      redis: redis() as Redis,
      logger: false,
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it('POST /rooms — 방을 만들고 게스트를 발급한다', async () => {
    const created = await enterRoom(server, { nickname: '요르' })

    expect(created.statusCode).toBe(200)
    expect(created.json.nickname).toBe('요르')
    expect(created.json.room_id).toMatch(/^[A-Z0-9]{6}$/)
    expect(created.json.game_code).toBe('YACHT_DICE')
    expect(created.json.token).not.toBe('')
    // 발급된 세션으로 곧바로 인증된다
    const identity = await new UserService(redis()).authenticate(
      created.json.id,
      `Bearer ${created.json.token}`,
    )
    expect(identity.nickname).toBe('요르')
  })

  it('POST /rooms — room_id가 있으면 참가한다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })

    const guest = await enterRoom(server, { nickname: '참가자', room_id: host.json.room_id })

    expect(guest.statusCode).toBe(200)
    expect(guest.json.game_code).toBe('YACHT_DICE')
    expect(guest.json.id).not.toBe(host.json.id)
    const snapshot = await new RoomService(redis()).getSnapshot(host.json.room_id)
    expect(snapshot.players).toHaveLength(2)
    expect(snapshot.hostId).toBe(host.json.id)
  })

  it('POST /rooms — 정원은 게임이 정한다', async () => {
    const duel = await enterRoom(server, { nickname: '결투' }, '?game_code=DUEL')

    expect(await redis().hget(roomKey(duel.json.room_id), 'capacity')).toBe('2')
    expect(await redis().hget(roomKey(duel.json.room_id), 'gameCode')).toBe('DUEL')
  })

  it('POST /rooms — 유효한 세션 토큰이면 회원으로 입장한다', async () => {
    const users = new UserService(redis())
    const token = await users.openMemberSession('member-1', '회원')

    const entered = await enterRoom(server, { session_token: token })

    expect(entered.json.id).toBe('member-1')
    expect(entered.json.nickname).toBe('회원')
    expect(entered.json.token).toBe(token)
  })

  it('POST /rooms — 본문 닉네임이 프로필 닉네임보다 우선한다', async () => {
    const users = new UserService(redis())
    const token = await users.openMemberSession('member-1', '프로필이름')

    const entered = await enterRoom(server, { nickname: '이번판이름', session_token: token })

    expect(entered.json.nickname).toBe('이번판이름')
    // 프로필(세션) 닉네임은 그대로 둔다
    expect(await redis().hget('user:member-1', 'nickname')).toBe('프로필이름')
  })

  it('POST /rooms — 만료된 토큰은 조용히 게스트로 폴백한다', async () => {
    const entered = await enterRoom(server, { nickname: '요르', session_token: '만료된-토큰' })

    expect(entered.statusCode).toBe(200)
    expect(entered.json.token).not.toBe('만료된-토큰')
  })

  it('POST /rooms?party=true — 대시보드는 명단에도 host에도 들어가지 않는다', async () => {
    const dashboard = await enterRoom(server, {}, '?game_code=YACHT_DICE&party=true')

    expect(dashboard.statusCode).toBe(200)
    expect(dashboard.json.nickname).toBe('대시보드')
    expect(await redis().exists(playersKey(dashboard.json.room_id))).toBe(0)
    expect(await redis().hget(roomKey(dashboard.json.room_id), 'mode')).toBe('PARTY')
    expect(await redis().hget(`user:${dashboard.json.id}`, 'host')).toBe('')

    // 첫 컨트롤러가 host가 된다
    const phone = await enterRoom(server, { nickname: '폰1', room_id: dashboard.json.room_id })
    expect(await redis().hget(roomKey(dashboard.json.room_id), 'hostId')).toBe(phone.json.id)
  })

  it('POST /rooms — 오류는 plain-text 코드다', async () => {
    const blank = await enterRoom(server, { nickname: ' ' })
    expect(blank.statusCode).toBe(400)
    expect(blank.body).toBe('invalid_nickname')

    const badGame = await enterRoom(server, { nickname: '요르' }, '?game_code=CHESS')
    expect(badGame.statusCode).toBe(400)
    expect(badGame.body).toBe('invalid_game_code')

    const missing = await enterRoom(server, { nickname: '요르', room_id: 'NOPE12' })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toBe('room_not_found')
  })

  it('POST /rooms — 정원이 차면 409 room_full, 시작된 방은 409 game_started', async () => {
    const host = await enterRoom(server, { nickname: '결투1' }, '?game_code=DUEL')
    const second = await enterRoom(server, { nickname: '결투2', room_id: host.json.room_id })
    expect(second.statusCode).toBe(200)

    const third = await enterRoom(server, { nickname: '결투3', room_id: host.json.room_id })
    expect(third.statusCode).toBe(409)
    expect(third.body).toBe('room_full')

    await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.json.room_id}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })
    const late = await enterRoom(server, { nickname: '늦은사람', room_id: host.json.room_id })
    expect(late.statusCode).toBe(409)
    expect(late.body).toBe('game_started')
  })

  it('DELETE /rooms/{code}/players/me — 나가면 204·세션의 방 정보가 지워진다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })
    await enterRoom(server, { nickname: '참가자', room_id: host.json.room_id })

    const response = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${host.json.room_id}/players/me`,
      headers: authHeaders(host.json.id, host.json.token),
    })

    expect(response.statusCode).toBe(204)
    expect(await redis().hgetall(`user:${host.json.id}`)).not.toHaveProperty('roomId')
    const snapshot = await new RoomService(redis()).getSnapshot(host.json.room_id)
    expect(snapshot.players).toHaveLength(1)
  })

  it('DELETE /rooms/{code}/players/me — 401은 invalid_guest_session, 없는 방은 404', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })

    const unauthorized = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${host.json.room_id}/players/me`,
      headers: authHeaders(host.json.id, '틀린-토큰'),
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(unauthorized.body).toBe('invalid_guest_session')

    const missing = await server.app.inject({
      method: 'DELETE',
      url: '/api/v1/rooms/NOPE12/players/me',
      headers: authHeaders(host.json.id, host.json.token),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.body).toBe('room_not_found')
  })

  it('POST /rooms/{code}/games — host만 시작할 수 있다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })
    const guest = await enterRoom(server, { nickname: '참가자', room_id: host.json.room_id })

    const byGuest = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.json.room_id}/games`,
      headers: authHeaders(guest.json.id, guest.json.token),
    })
    expect(byGuest.statusCode).toBe(403)
    expect(byGuest.body).toBe('host_only')

    const byHost = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.json.room_id}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })
    expect(byHost.statusCode).toBe(200)
    const started = byHost.json() as { gameId: string; snapshot: { phase: string } }
    expect(started.gameId).not.toBe('')
    expect(started.snapshot.phase).toBe('PLAYING')
  })

  it('POST /rooms/{code}/games — 인원이 모자라면 409 game_not_ready', async () => {
    const host = await enterRoom(server, { nickname: '결투1' }, '?game_code=DUEL')

    const response = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.json.room_id}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })

    expect(response.statusCode).toBe(409)
    expect(response.body).toBe('game_not_ready')
  })

  it('POST /rooms/{code}/lobby — FINISHED에서만 되돌린다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })
    const roomCode = host.json.room_id
    attachPresence(server, roomCode, host.json)
    await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomCode}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })

    const tooEarly = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomCode}/lobby`,
      headers: authHeaders(host.json.id, host.json.token),
    })
    expect(tooEarly.statusCode).toBe(409)
    expect(tooEarly.body).toBe('not_finished')

    await redis().hset(roomKey(roomCode), 'phase', 'FINISHED')
    const response = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomCode}/lobby`,
      headers: authHeaders(host.json.id, host.json.token),
    })
    expect(response.statusCode).toBe(204)
    expect(await redis().hget(roomKey(roomCode), 'phase')).toBe('LOBBY')
  })

  it('방을 떠난 옛 host는 조작할 수 없다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })
    const roomCode = host.json.room_id
    await enterRoom(server, { nickname: '참가자', room_id: roomCode })
    await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${roomCode}/players/me`,
      headers: authHeaders(host.json.id, host.json.token),
    })

    const response = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomCode}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).toBe('host_only')
  })

  it('GET /games/{id} — 인증 없이 조회하고, 없는 게임도 200이다', async () => {
    const host = await enterRoom(server, { nickname: '호스트' })
    attachPresence(server, host.json.room_id, host.json)
    const started = await server.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.json.room_id}/games`,
      headers: authHeaders(host.json.id, host.json.token),
    })
    const { gameId } = started.json() as { gameId: string }

    const found = await server.app.inject({ method: 'GET', url: `/api/v1/games/${gameId}` })
    expect(found.statusCode).toBe(200)
    expect(found.json()).toMatchObject({ roomCode: host.json.room_id, phase: 'PLAYING' })

    const missing = await server.app.inject({ method: 'GET', url: '/api/v1/games/없는-게임' })
    expect(missing.statusCode).toBe(200)
    expect(missing.json()).toMatchObject({ roomCode: null, phase: null, players: [] })
  })
})
