import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../test/redisHarness.js'
import { RedisYachtDiceStateStore } from '../game/yacht/index.js'
import { roomKey } from '../room/keys.js'
import { useServer } from './serverHarness.js'

describeRedis('서버 배선 — 게임 모듈과 라운드 진행', () => {
  const redis = useRedis()
  const h = useServer(redis)

  /**
   * 이 테스트 하나가 두 함정을 동시에 막는다. 타이머가 자기 브로드캐스터를 새로
   * 만들었다면 `round.start`가 이 소켓에 도착하지 않고, 자기 레지스트리를 새로
   * 만들었다면 접속한 플레이어가 "오프라인"으로 보여 타이머가 아예 걸리지 않는다
   * (`start`가 null을 반환한다).
   */
  it('라운드 타이머가 WS 게이트웨이와 같은 브로드캐스터·레지스트리를 쓴다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    // 사람 둘이어야 시계가 돈다 — 혼자 있는 방은 마감 없이 시작하므로(연습 방)
    // 여기서 보려는 "오프라인 판정 때문에 null"과 구별되지 않는다.
    const guest = await h.enterRoom(instance, { nickname: '손님', room_id: host.room_id })

    const client = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })

    const state = await instance.rounds.synchronization.initialize(host.room_id, 1, [
      host.id,
      guest.id,
    ])
    const deadline = await instance.rounds.timer.start(host.room_id, state)

    // null이면 레지스트리가 갈라져 접속자를 오프라인으로 판정했다는 뜻이다.
    expect(deadline).not.toBeNull()
    expect(instance.rounds.timer.currentDeadline(host.room_id)).toBe(deadline)
    const started = await client.await('game.yacht_dice.round.start')
    expect(started).toMatchObject({
      roomId: host.room_id,
      payload: { roundNumber: 1, activePlayerId: host.id, turnOrder: [host.id, guest.id] },
    })

    await instance.rounds.timer.cancelRoom(host.room_id)
    client.socket.close()
    guestClient.socket.close()
  })

  /**
   * **부팅 재무장이 실제로 판을 이어가는가**(deploy/PLAN.md PR 6).
   *
   * 이 저장소에서 배포가 게임을 끊어 온 이유는 라운드 상태가 아니라 **마감 시각**이었다.
   * 상태는 진작 Redis에 있었지만 마감은 프로세스 인메모리 Map이었고, 되살릴 방법이
   * 없으니 부팅 때 PLAYING 방을 전부 닫는 것이 유일한 대책이었다
   * (`closeUnrecoverableGamesOnStartup`).
   *
   * 그래서 여기서는 **진짜로 재시작한다**: 첫 서버를 닫고, 같은 Redis를 물려받은 두
   * 번째 서버를 세워 `h.listen()`을 부른다. 판정 기준은 "저장했는가"가 아니라
   * **"닫히지 않고, 같은 마감으로 이어지는가"** 다. 재무장을 빼면 방이 닫혀 이 테스트가
   * 깨진다.
   */
  it('재시작해도 진행 중이던 판을 같은 마감으로 이어간다', async () => {
    const first = await h.build()
    const url = await h.listen(first)
    const host = await h.enterRoom(first, { nickname: '호스트' })
    // 사람 둘이어야 시계가 돈다(연습 방은 마감이 null이라 "되살렸다"를 구별할 수 없다).
    const guest = await h.enterRoom(first, { nickname: '손님', room_id: host.room_id })
    const hostClient = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })
    await h.startGame(first, host)
    await hostClient.await('game.yacht_dice.round.start')

    const deadlineBefore = first.rounds.timer.currentDeadline(host.room_id)
    expect(typeof deadlineBefore).toBe('number')

    // ── 재시작 ──────────────────────────────────────────────────────────────
    hostClient.socket.close()
    guestClient.socket.close()
    await first.close()

    const second = await h.build()
    await second.listen()

    // 방이 살아 있어야 한다. 예전 정책이었다면 여기서 방이 닫혀 있다.
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('PLAYING')

    // 마감이 **같은 값으로** 되살아났다. 새로 계산했다면 값이 달라진다.
    expect(second.rounds.timer.currentDeadline(host.room_id)).toBe(deadlineBefore)

    /*
     * **자기 자리로 돌아올 수 있어야 한다.** 좌석 레지스트리는 프로세스 메모리라
     * 재시작에 사라지므로, 재접속 판정을 그것만으로 하면 이 join이 새 참가로 보여
     * `GAME_ALREADY_STARTED`로 거절된다 — 그러면 마감을 되살려도 아무도 돌아올 수
     * 없어 재무장이 무의미하다. 방 명단(Redis)이 자리의 영속 근거다.
     *
     * 그리고 스냅샷의 `roundDeadline`이 **원래 값**이어야 한다. 최초 참가 경로로
     * 흘렀다면 `resume()`이 불려 새 25초로 덮였을 것이다.
     */
    const secondUrl = `ws://127.0.0.1:${(second.app.server.address() as AddressInfo).port}/ws/v1/game`
    const back = await h.connect(secondUrl)
    back.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: host.token },
    })
    const rejoined = await back.await('sys.reconnected')
    expect(
      (rejoined.payload as { snapshot: { game?: { roundDeadline?: number } } }).snapshot.game
        ?.roundDeadline,
    ).toBe(deadlineBefore)

    back.socket.close()
  })

  /**
   * **(a) 운영 라운드 상태 저장소는 Redis다.**
   *
   * 타입으로는 `InMemoryRoundStateStore`(2.4의 테스트 시드)도 그대로 들어맞으므로
   * 여기서는 **동작으로** 판정한다: 서버가 만든 상태를 **다른 저장소 인스턴스**가
   * 읽을 수 있어야 한다. 인메모리였다면 프로세스 밖(= 재시작 후)에서 읽을 방법이
   * 없고, 그게 곧 "재시작마다 진행 중 게임 소실"이다.
   */
  it('라운드 상태가 Redis에 남아 다른 인스턴스에서 읽힌다', async () => {
    const instance = await h.build()
    const host = await h.enterRoom(instance, { nickname: '호스트' })

    await instance.rounds.synchronization.initialize(host.room_id, 1, [host.id])

    // 재시작을 흉내낸다 — 같은 Redis를 보는 새 저장소.
    const restarted = new RedisYachtDiceStateStore(redis())
    const recovered = await restarted.findByRoomId(host.room_id)
    expect(recovered?.roundNumber).toBe(1)
    expect(recovered?.activePlayerId).toBe(host.id)
    // 키 이름은 운영 Redis에 이미 이 모양으로 들어 있는 계약이다.
    expect(await redis().exists(`room:${host.room_id}:game:YACHT_DICE:state`)).toBe(1)
    // 스위퍼(2.8)가 쓰는 목록도 같은 저장소에서 나온다.
    expect(await instance.rounds.states.roomIds()).toContain(host.room_id)
  })

  /**
   * **(d) 야추 모듈(3.1)이 등록되어 있다.** REST로 게임을 시작하면 모듈 훅이 돌아야
   * 한다. 여기서 한 번에 네 인스턴스의 동일성이 확인된다: 레지스트리(phase playing) ·
   * 브로드캐스터(소켓이 state.sync를 받음) · 스냅샷 서비스(그 안의 방 명단) ·
   * 라운드 저장소(1라운드 상태 생성).
   */
  it('야추 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const client = await h.joined(url, host)

    expect(instance.games.byCode('YACHT_DICE')).toBeDefined()
    await h.startGame(instance, host)

    const sync = await client.await('game.yacht_dice.state.sync')
    expect(sync).toMatchObject({ roomId: host.room_id })
    // markPhase('playing')은 모듈의 몫이다 — 빠지면 끊김이 offline이 아니라 player_left다.
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    const state = await instance.rounds.states.findByRoomId(host.room_id)
    expect(state?.roundNumber).toBe(1)
    expect(state?.activePlayerId).toBe(host.id)
    // 첫 턴 타이머까지 걸렸다(모듈이 타이머를 같은 인스턴스로 받았다는 증거).
    expect(instance.rounds.timer.currentDeadline(host.room_id)).toBeDefined()

    client.socket.close()
  })

  /**
   * **세 게임을 모두 검증한다**(deploy/PLAN.md PR 6). 야추만 고치면 절반이다 —
   * 결투·탁구도 재시작 뒤 이어져야 하고, 그 둘은 마감(`nextActionAt`)이 처음부터
   * 상태 안의 절대 시각이라 되살릴 것이 예약뿐이다. 즉 이 테스트가 보는 것은
   * "부팅 재무장이 야추만 부르고 있지 않은가"다.
   *
   * 판정 기준: 재시작 뒤에도 방이 닫히지 않고 게임 상태가 Redis에 남아 있으며,
   * 자기 자리로 돌아올 수 있다.
   */
  it.each([
    ['DUEL', 'game.duel.state'],
    ['PING_PONG', 'game.ping_pong.state'],
  ])('%s도 재시작 뒤 이어진다', async (gameCode, stateType) => {
    const first = await h.build()
    const url = await h.listen(first)
    const host = await h.enterRoom(first, { nickname: '호스트' }, gameCode)
    const guest = await h.enterRoom(first, { nickname: '손님', room_id: host.room_id })
    const hostClient = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })
    await h.startGame(first, host)
    await hostClient.await(stateType)

    hostClient.socket.close()
    guestClient.socket.close()
    await first.close()

    const second = await h.build()
    await second.listen()

    // 예전 정책(부팅 때 PLAYING 방 전부 닫기)이었다면 둘 다 여기서 깨진다.
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('PLAYING')
    expect(await redis().exists(`room:${host.room_id}:game:${gameCode}:state`)).toBe(1)

    const secondUrl = `ws://127.0.0.1:${(second.app.server.address() as AddressInfo).port}/ws/v1/game`
    const back = await h.connect(secondUrl)
    back.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: host.token },
    })
    await back.await('sys.reconnected')

    back.socket.close()
  })

  /** **(d) 듀얼 모듈(3.3)** — 2인 방을 시작하면 결투 상태와 방송이 나가야 한다. */
  it('듀얼 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '결투1' }, 'DUEL')
    const guest = await h.enterRoom(instance, { nickname: '결투2', room_id: host.room_id })
    const hostClient = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })

    expect(instance.games.byCode('DUEL')).toBeDefined()
    await h.startGame(instance, host)

    const state = await guestClient.await('game.duel.state')
    expect(state).toMatchObject({ roomId: host.room_id, payload: { phase: 'WAITING' } })
    await hostClient.await('game.duel.state.sync')
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    // 결투 상태는 Redis에 있어야 한다(모듈이 스토어를 받았다는 증거).
    expect(await redis().exists(`room:${host.room_id}:game:DUEL:state`)).toBe(1)

    // 몰수 → 종료. **듀얼도 같은 종료 서비스를 받았는지**가 여기서 드러난다 —
    // 스텁이면 결투가 FINISHED가 되어도 `game.over`가 나가지 않는다(3.3의 지적).
    guestClient.send({ type: 'room.leave', ts: Date.now(), payload: {} })
    const over = await hostClient.await('game.duel.game.over')
    expect(over).toMatchObject({ roomId: host.room_id })
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('FINISHED')

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /** **(d) 탁구 모듈(3.4)** — 같은 이유·같은 모양. */
  it('탁구 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '탁구1' }, 'PING_PONG')
    const guest = await h.enterRoom(instance, { nickname: '탁구2', room_id: host.room_id })
    const hostClient = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })

    expect(instance.games.byCode('PING_PONG')).toBeDefined()
    await h.startGame(instance, host)

    const state = await guestClient.await('game.ping_pong.state')
    expect(state).toMatchObject({ roomId: host.room_id })
    await hostClient.await('game.ping_pong.state.sync')
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    expect(await redis().exists(`room:${host.room_id}:game:PING_PONG:state`)).toBe(1)

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /**
   * **(b) 라운드 타이머가 받은 게임 종료 판정이 스텁이 아니다.**
   *
   * 예전 자리에는 항상 `false`를 돌려주는 경고 스텁이 있었다. 그 상태에서는 방이
   * FINISHED로 전이되지 않고 `game.over`도 나가지 않아 **클라이언트가 결과 화면으로
   * 넘어가지 못한다**(3.3·3.4가 함께 지적한 항목). 스텁이면 타이머가
   * `round_cap_reached_without_finish`로 조용히 멈춘다.
   *
   * 그래서 판정을 **타이머의 진행 경로로** 시험한다 — `instance.completion`을 직접
   * 부르면 "타이머가 그 인스턴스를 받았는가"는 확인되지 않는다.
   */
  it('라운드 타이머의 턴 진행이 game.over까지 이어진다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const client = await h.joined(url, host)
    await h.startGame(instance, host)

    // 마지막 라운드를 만든다 — 모듈은 12라운드로 시작하므로 총 1라운드로 다시 깐다.
    await instance.rounds.synchronization.remove(host.room_id)
    await instance.rounds.synchronization.initialize(host.room_id, 1, [host.id], 1)
    // 주사위는 서버가 만든다(원칙 1) — 제출에는 그 값을 그대로 실어야 한다.
    const rolled = await instance.rounds.synchronization.recordRoll(host.room_id, host.id, {
      roundNumber: 1,
      rollCount: 1,
      held: [false, false, false, false, false],
    })
    const submitted = await instance.rounds.submissions.submit(host.room_id, host.id, {
      roundNumber: 1,
      category: 'choice',
      dice: [...(rolled.activeDice ?? [])],
    })
    await instance.rounds.timer.advanceTurn(host.room_id, submitted)

    const over = await client.await('game.yacht_dice.game.over')
    // 점수는 서버가 재계산한 값이다 — choice는 눈의 합.
    const expected = [...(rolled.activeDice ?? [])].reduce((sum, die) => sum + die, 0)
    expect(over).toMatchObject({
      roomId: host.room_id,
      payload: { rankings: [{ playerId: host.id, rank: 1, total: expected }] },
    })
    // phase(finished)는 스냅샷으로만 전달된다 — 이것까지 나가야 결과 화면으로 넘어간다.
    await client.await('game.yacht_dice.state.sync')
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('FINISHED')
    expect(instance.registry.phaseOf(host.room_id)).toBe('finished')
    // 두 번째 호출은 아무것도 하지 않는다(Lua가 PLAYING만 전이시킨다).
    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(false)

    client.socket.close()
  })

  /**
   * **(c) 전적 보관(4.4)** + **(g) 랭킹 캐시 evict(4.5)** — 둘 다 게임 종료 경로에서
   * 확인한다. 판정은 MySQL 풀 대역이 받은 질의다:
   *
   * - `noopMatchArchive` 스텁이 남아 있으면 `INSERT INTO matches`가 **아예 없다**.
   * - 캐시가 배선되지 않았으면 상위 목록 두 번째 조회가 MySQL로 다시 내려간다(1 → 2).
   * - evict가 **다른 인스턴스**를 비우면 종료 후 조회가 여전히 캐시에서 답한다(2가 안 된다).
   */
  it('전적 보관과 랭킹 캐시 evict가 게임 종료 경로에 붙어 있다', async () => {
    const mysql = h.mysqlDouble()
    const instance = await h.build({}, { mysql: mysql.pool })
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const client = await h.joined(url, host)
    const gameId = await h.startGame(instance, host)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    // 캐시를 채운다 — 같은 인자의 두 번째 조회는 MySQL로 내려가지 않아야 한다.
    expect(await h.weeklyRanking(instance)).toMatchObject({
      entries: [{ rank: 1, userId: 'member-1', bestScore: 42 }],
    })
    await h.weeklyRanking(instance)
    expect(mysql.weeklyQueries()).toBe(1)

    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(true)

    expect(mysql.archived()).toBe(true)
    await h.weeklyRanking(instance)
    expect(mysql.weeklyQueries()).toBe(2)

    client.socket.close()
  })

  /**
   * **(c) MySQL이 없어도 기동·종료는 성공한다.** 풀은 lazy이고(4.1) 보관 실패는
   * 2.7이 삼켜 `onArchiveFailure`로 흘린다 — 눈앞의 사용자가 결과 화면으로 넘어가는
   * 것이 전적 한 줄보다 중요하다.
   */
  it('MySQL이 없어도 게임 종료가 진행된다', async () => {
    const instance = await h.build({ DB_URL: 'jdbc:mysql://127.0.0.1:1/none' })
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const client = await h.joined(url, host)
    const gameId = await h.startGame(instance, host)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(true)
    await client.await('game.yacht_dice.game.over')

    client.socket.close()
  })

  /**
   * **(e) 라우트 4개가 등록되어 있다.** 등록 전에는 전부 **404 + 빈 본문**이므로,
   * 각 API의 고유한 인증·검증 응답이 곧 "배선됐는가"의 판정이 된다. 여기서 고른
   * 지점은 모두 MySQL을 건드리기 **전**에 답이 정해지는 곳이다.
   */
})
