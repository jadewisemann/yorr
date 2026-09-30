import { afterEach, describe, expect, it } from 'vitest'
import { randomFrame } from '../fuzz/frames.js'
import { createPrng, iterationsFromEnv, seedFromEnv } from '../fuzz/prng.js'
import { LIMITS, WS_ERROR_CODES } from './contract.js'
import { request, startGame } from './http.js'
import { leaveAll, type Seat, seatedRoom } from './players.js'
import { describeTarget, escapedHandlerErrors, useTarget } from './target.js'
import { WsClient } from './ws.js'

/**
 * 적대적 입력 — "서버는 어떤 프레임에도 죽지 않고, 망가진 봉투를 내보내지 않는다."
 *
 * 앞쪽은 알려진 공격 모양(깨진 JSON·크기 초과·깨진 UTF-8)을 하나씩, 뒤쪽은 시드 하나에서
 * 나오는 무작위 프레임 수백 개를 쏟는다. 퍼저가 실패하면 테스트 이름의 시드를
 * `FUZZ_SEED`로 주고 다시 돌리면 같은 프레임이 같은 순서로 나간다.
 */
describeTarget('적대적 입력 (블랙박스)', () => {
  const target = useTarget()
  let seats: Seat[] = []
  const sockets: WsClient[] = []

  afterEach(async () => {
    await leaveAll(seats)
    await Promise.all(sockets.splice(0).map((socket) => socket.close()))
    seats = []
  })

  const open = async (label: string): Promise<WsClient> => {
    const socket = await WsClient.open(target().wsUrl, label)
    sockets.push(socket)
    await socket.next('sys.connected')
    return socket
  }

  /** 소켓별 직렬 처리라, 이 ping의 pong이 오면 앞서 보낸 프레임은 전부 처리된 것이다. */
  const roundTrip = async (socket: WsClient): Promise<void> => {
    const before = socket.all('sys.pong').length
    socket.send('sys.ping', { clientTs: Date.now() })
    await socket.next('sys.pong', () => socket.all('sys.pong').length > before)
  }

  /** 서버가 살아 있다 — 새 소켓이 인사를 받고 ping에 답한다. */
  const expectServerAlive = async (): Promise<void> => {
    const fresh = await open('probe')
    await roundTrip(fresh)
    const health = await request(target(), 'GET', '/actuator/health')
    expect([200, 503]).toContain(health.status)
  }

  describe('알려진 공격 모양', () => {
    it.each([
      { name: '깨진 JSON', frame: '{"type":' },
      { name: '객체가 아닌 JSON', frame: '[1,2,3]' },
      { name: 'type 없는 봉투', frame: '{"ts":1,"payload":{}}' },
      { name: 'type이 숫자', frame: '{"type":7,"ts":1,"payload":{}}' },
      { name: '빈 프레임', frame: '' },
    ])('$name → INVALID_MESSAGE, 연결 유지', async ({ frame }) => {
      const socket = await open('garbage')

      socket.sendRaw(frame)

      expect((await socket.next('error')).payload).toMatchObject({ code: 'INVALID_MESSAGE' })
      await roundTrip(socket)
      expect(socket.isOpen).toBe(true)
    })

    it('UTF-8이 아닌 바이너리 프레임도 INVALID_MESSAGE로 끝난다', async () => {
      const socket = await open('binary')

      socket.sendRaw(Buffer.from([0xff, 0xfe, 0x00, 0x7b]), true)

      expect((await socket.next('error')).payload).toMatchObject({ code: 'INVALID_MESSAGE' })
      expect(socket.isOpen).toBe(true)
    })

    it('상한 크기는 받고, 1바이트 넘기면 그 연결만 1009로 닫힌다', async () => {
      const socket = await open('big')

      socket.sendRaw(`"${'x'.repeat(LIMITS.wsMessageBytes - 2)}"`)
      expect((await socket.next('error')).payload).toMatchObject({ code: 'INVALID_MESSAGE' })

      socket.sendRaw('x'.repeat(LIMITS.wsMessageBytes + 1))
      expect((await socket.closed).code).toBe(1009)
      await expectServerAlive()
    })

    it('깨진 UTF-8 텍스트 프레임은 그 연결만 1007로 닫힌다', async () => {
      const socket = await open('utf8')

      socket.sendRaw(Buffer.from([0xff, 0xfe, 0xfd]))

      expect((await socket.closed).code).toBe(1007)
      await expectServerAlive()
    })
  })

  describe('프로토콜 퍼저', () => {
    const seed = seedFromEnv()
    const frames = iterationsFromEnv('FUZZ_ITERATIONS', 400)

    it(`seed=${seed} · ${frames}프레임: 진행 중인 판에 무작위 프레임을 쏟아도 계약이 지켜진다`, async () => {
      const random = createPrng(seed)
      seats = await seatedRoom(target(), 2)
      const [host, fuzzer] = seats as [Seat, Seat]
      await startGame(target(), host.entrant)
      const context = {
        roomId: host.entrant.roomId,
        playerIds: [host.entrant.id, fuzzer.entrant.id],
      }
      const sent: string[] = []

      for (let index = 0; index < frames; index += 1) {
        const frame = randomFrame(random, context)
        sent.push(frame)
        fuzzer.ws.sendRaw(frame)
        if (index % 25 === 24) await roundTrip(fuzzer.ws)
      }
      await roundTrip(fuzzer.ws)
      await roundTrip(host.ws)

      const replay = `FUZZ_SEED=${seed} FUZZ_ITERATIONS=${frames} 로 재현. 마지막 프레임:\n${sent
        .slice(-5)
        .map((frame) => frame.slice(0, 300))
        .join('\n')}`
      // 1. 서버가 보낸 것은 전부 봉투 모양이다.
      expect([...fuzzer.ws.malformed, ...host.ws.malformed], replay).toEqual([])
      // 2. 오류는 전부 계약 안의 코드이고 사람이 읽을 메시지가 있다.
      const strayErrors = fuzzer.ws
        .all('error')
        .map((message) => message.payload as { code?: unknown; message?: unknown })
        .filter(
          (payload) =>
            !(WS_ERROR_CODES as readonly unknown[]).includes(payload.code) ||
            typeof payload.message !== 'string',
        )
      expect(strayErrors, replay).toEqual([])
      // 3. 쓰레기를 보냈다고 서버가 연결을 끊지 않는다(끊는 경우는 하트비트·교체·프레임 오류뿐).
      expect([fuzzer.ws.isOpen, host.ws.isOpen], replay).toEqual([true, true])
      // 4. 핸들러 밖으로 새어 나온 예외가 없다(= 버그가 없다).
      expect(escapedHandlerErrors(target()), replay).toEqual([])
      await expectServerAlive()
    })
  })
})
