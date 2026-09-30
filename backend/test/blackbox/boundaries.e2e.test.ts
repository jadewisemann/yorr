import { afterEach, describe, expect, it } from 'vitest'
import { LIMITS } from './contract.js'
import { enterRoom, enterRoomRaw, nicknameFor, request, startGame } from './http.js'
import { leaveAll, type Seat, seatedRoom } from './players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from './target.js'
import { WsClient } from './ws.js'

/**
 * 경계값 테스트 — 상한·하한의 **안쪽 한 칸과 바깥쪽 한 칸**을 모두 찌른다(SQLite의 boundary
 * value testing). 오류 표면은 형식이 섞여 있고 그 모양이 계약이다(DESIGN.md 「오류 계약」):
 * REST 대부분은 plain-text 코드, WS는 `error` 봉투의 SCREAMING_SNAKE 코드.
 */
describeTarget('경계값 (블랙박스)', () => {
  const target = useTarget()
  let seats: Seat[] = []
  const sockets: WsClient[] = []

  afterEach(async () => {
    await leaveAll(seats)
    await Promise.all(sockets.splice(0).map((socket) => socket.close()))
    seats = []
    expect(escapedHandlerErrors(target())).toEqual([])
  })

  describe('닉네임', () => {
    it.each([
      { name: '상한 길이', nickname: 'n'.repeat(LIMITS.nicknameMax), status: 200 },
      { name: '상한 + 1', nickname: 'n'.repeat(LIMITS.nicknameMax + 1), status: 400 },
      { name: '공백뿐', nickname: '   ', status: 400 },
      { name: '빈 문자열', nickname: '', status: 400 },
      { name: '한글 스무 자', nickname: '가'.repeat(LIMITS.nicknameMax), status: 200 },
    ])('$name → $status', async ({ nickname, status }) => {
      const result = await enterRoomRaw(target(), { nickname })

      expect(result.status).toBe(status)
      if (status === 400) expect(result.text).toBe('invalid_nickname')
    })

    it('앞뒤 공백은 잘라서 저장한다', async () => {
      const entrant = await enterRoom(target(), '  공백손님  ')

      expect(entrant.nickname).toBe('공백손님')
    })
  })

  describe('방', () => {
    it(`정원 ${LIMITS.yachtCapacity}명까지 들어가고 다음 사람은 409 room_full`, async () => {
      const host = await enterRoom(target(), nicknameFor('host'))
      for (let seat = 2; seat <= LIMITS.yachtCapacity; seat += 1) {
        await enterRoom(target(), nicknameFor(`p${seat}`), host.roomId)
      }

      const overflow = await enterRoomRaw(target(), { nickname: 'late', room_id: host.roomId })

      expect({ status: overflow.status, body: overflow.text }).toEqual({
        status: 409,
        body: 'room_full',
      })
    })

    it('없는 방은 404 room_not_found, 모르는 게임은 400 invalid_game_code', async () => {
      const missing = await enterRoomRaw(target(), { nickname: 'ghost', room_id: 'ZZZ999' })
      const unknownGame = await enterRoomRaw(target(), { nickname: 'ghost' }, 'CHESS')

      expect([missing.status, missing.text]).toEqual([404, 'room_not_found'])
      expect([unknownGame.status, unknownGame.text]).toEqual([400, 'invalid_game_code'])
    })

    it('게임이 시작된 방에는 새로 들어갈 수 없다(409 game_started)', async () => {
      seats = await seatedRoom(target(), 2)
      await startGame(target(), (seats[0] as Seat).entrant)

      const late = await enterRoomRaw(target(), {
        nickname: 'late',
        room_id: (seats[0] as Seat).entrant.roomId,
      })

      expect([late.status, late.text]).toEqual([409, 'game_started'])
    })
  })

  describe('채팅', () => {
    const chatError = async (seat: Seat, text: string): Promise<unknown> => {
      const msgId = seat.ws.send('chat.send', { text })
      return (await seat.ws.next('error', (m) => refOf(m.payload) === msgId)).payload
    }

    it(`${LIMITS.chatTextMax}자는 보내지고 ${LIMITS.chatTextMax + 1}자·공백은 INVALID_MESSAGE`, async () => {
      seats = await seatedRoom(target(), 1)
      const [host] = seats as [Seat]

      host.ws.send('chat.send', { text: 'c'.repeat(LIMITS.chatTextMax) })
      expect(await host.ws.next('chat.message')).toBeDefined()

      expect(await chatError(host, 'c'.repeat(LIMITS.chatTextMax + 1))).toMatchObject({
        code: 'INVALID_MESSAGE',
      })
      expect(await chatError(host, '   ')).toMatchObject({ code: 'INVALID_MESSAGE' })
    })

    it(`10초 안에 ${LIMITS.chatBurst}번까지 받고 그다음은 RATE_LIMITED`, async () => {
      seats = await seatedRoom(target(), 1)
      const [host] = seats as [Seat]

      for (let index = 0; index < LIMITS.chatBurst; index += 1) {
        host.ws.send('chat.send', { text: `말 ${index}` })
        await host.ws.next('chat.message')
      }

      expect(await chatError(host, '한 번 더')).toMatchObject({ code: 'RATE_LIMITED' })
    })
  })

  describe('WS 입장', () => {
    const joinError = async (payload: Record<string, unknown>): Promise<unknown> => {
      const socket = await WsClient.open(target().wsUrl, 'joiner')
      sockets.push(socket)
      const msgId = socket.send('room.join', payload)
      const error = await socket.next('error', (m) => refOf(m.payload) === msgId)
      expect(socket.isOpen).toBe(true)
      return error.payload
    }

    it('모르는 세션은 SESSION_EXPIRED, 없는 방은 ROOM_NOT_FOUND — 연결은 유지된다', async () => {
      const host = await enterRoom(target(), nicknameFor('host'))

      expect(await joinError({ roomId: host.roomId, sessionToken: 'not-a-token' })).toMatchObject({
        code: 'SESSION_EXPIRED',
      })
      expect(await joinError({ roomId: 'GONE01', nickname: 'ghost' })).toMatchObject({
        code: 'ROOM_NOT_FOUND',
      })
    })

    it('방에 들지 않은 소켓의 게임 메시지는 AUTH_REQUIRED', async () => {
      const socket = await WsClient.open(target().wsUrl, 'outsider')
      sockets.push(socket)

      const msgId = socket.send('game.yacht_dice.dice.roll', { roundNumber: 1, rollCount: 1 })

      expect((await socket.next('error', (m) => refOf(m.payload) === msgId)).payload).toMatchObject(
        {
          code: 'AUTH_REQUIRED',
        },
      )
    })

    it('게임이 시작된 방에 새 사람이 WS로 들어오면 GAME_ALREADY_STARTED', async () => {
      seats = await seatedRoom(target(), 2)
      const host = (seats[0] as Seat).entrant
      const outsider = await enterRoom(target(), nicknameFor('out'))
      await startGame(target(), host)

      expect(await joinError({ roomId: host.roomId, sessionToken: outsider.token })).toMatchObject({
        code: 'GAME_ALREADY_STARTED',
      })
    })
  })

  describe('점수 후보 계산기 (무인증)', () => {
    const candidates = (dice: unknown) =>
      request(target(), 'POST', '/api/v1/games/any/score-candidates', { body: { dice } })

    it('주사위 5개(1~6)만 받는다 — 경계 밖은 400 + 빈 본문', async () => {
      const yacht = await candidates([6, 6, 6, 6, 6])
      expect(yacht.status).toBe(200)
      expect(yacht.json<{ candidates: Record<string, number> }>().candidates).toMatchObject({
        yacht: 50,
        sixes: 30,
      })

      for (const dice of [
        [1, 2, 3, 4],
        [1, 2, 3, 4, 5, 6],
        [0, 1, 2, 3, 4],
        [1, 2, 3, 4, 7],
        [1.5, 2, 3, 4, 5],
      ]) {
        const rejected = await candidates(dice)
        expect({ dice, status: rejected.status, body: rejected.text }).toEqual({
          dice,
          status: 400,
          body: '',
        })
      }
    })
  })

  it('존재하지 않는 액추에이터 경로는 404다(health·prometheus만 노출)', async () => {
    const env = await request(target(), 'GET', '/actuator/env')
    const health = await request(target(), 'GET', '/actuator/health')

    expect(env.status).toBe(404)
    expect([200, 503]).toContain(health.status)
    expect(health.json<{ status: string }>().status).toMatch(/^(UP|DOWN)$/)
  })
})

const refOf = (payload: unknown): unknown => (payload as { refMsgId?: unknown }).refMsgId
