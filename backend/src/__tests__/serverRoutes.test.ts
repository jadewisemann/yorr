import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../test/redisHarness.js'
import {
  SWEEP_INTERVAL_MS,
  type SweepSchedule,
  type SweepScheduler,
} from '../game/reconnect/index.js'
import { type Entrant, useServer } from './serverHarness.js'

describeRedis('서버 배선 — 라우트와 관측', () => {
  const redis = useRedis()
  const h = useServer(redis)

  it('조회·프로필·퀵매치·랭킹 라우트가 등록되어 있다', async () => {
    const instance = await h.build()

    // 2.9 조회 REST — 오류 본문이 JSON `{code,message}`인 유일한 표면이다.
    const scores = await instance.app.inject({ method: 'GET', url: '/api/v1/rooms/ROOM01/scores' })
    expect(scores.statusCode).toBe(401)
    expect(scores.json()).toMatchObject({ code: 'AUTH_FAILED' })
    const results = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/rooms/ROOM01/results',
    })
    expect(results.statusCode).toBe(401)
    // 인증 없는 순수 계산기다.
    const candidates = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/games/any/score-candidates',
      payload: { dice: [1, 1, 1, 2, 3] },
    })
    expect(candidates.statusCode).toBe(200)
    expect((candidates.json() as { candidates: Record<string, number> }).candidates.ones).toBe(3)

    // 4.3 프로필 — 세션 없는 요청은 401 plain-text `session_expired`(404가 아니다).
    const me = await instance.app.inject({ method: 'GET', url: '/api/v1/users/me' })
    expect(me.statusCode).toBe(401)
    expect(me.body).toBe('session_expired')
    const rename = await instance.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { nickname: '새이름' },
    })
    expect(rename.statusCode).toBe(401)

    // 3.5 퀵매치 — 401 본문이 `unauthorized`인 것이 이 API만의 계약이다.
    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      const response = await instance.app.inject({ method, url: '/api/v1/quick-matches' })
      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('unauthorized')
    }

    // 4.5 랭킹 — 상위 목록은 무인증이고 정수가 아닌 limit은 400 빈 본문이다.
    const badLimit = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/rankings/weekly?limit=abc',
    })
    expect(badLimit.statusCode).toBe(400)
    expect(badLimit.body).toBe('')
    const myRank = await instance.app.inject({ method: 'GET', url: '/api/v1/rankings/weekly/me' })
    expect(myRank.statusCode).toBe(401)
    expect(myRank.body).toBe('session_expired')
  })

  /**
   * **(e)+④ 퀵매치가 WS 게이트웨이와 같은 레지스트리를 본다.**
   *
   * 자동 시작 조건은 "전원의 소켓이 실제로 열려 있는가"다. 퀵매치가 자기
   * `RoomSessionRegistry`를 새로 만들면 그 조건이 **영구히 거짓**이 되어 매칭된 방이
   * 영원히 시작되지 않는다(타입체크·빌드는 통과한다). 그래서 여기서는 진짜 소켓
   * 두 개로 폴링까지 재현한다.
   */
  it('퀵매치 자동 시작이 진짜 소켓 두 개로 성립한다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    // 게스트 세션을 얻는 통로는 방 입장이다. 큐에 들어가려면 세션에 방이 없어야
    // 하므로(`already_in_room`) 곧바로 나온다 — `clearRoom`이 방·티켓을 함께 비운다.
    const first = await h.enterRoom(instance, { nickname: '한명' }, 'DUEL')
    const second = await h.enterRoom(instance, { nickname: '두명' }, 'DUEL')
    for (const user of [first, second]) {
      const left = await instance.app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${user.room_id}/players/me`,
        headers: h.authHeaders(user),
      })
      expect(left.statusCode).toBe(204)
    }

    const enter = async (user: Entrant): Promise<{ status: string; roomId: string | null }> => {
      const response = await instance.app.inject({
        method: 'POST',
        url: '/api/v1/quick-matches?game_code=DUEL',
        headers: h.authHeaders(user),
      })
      expect(response.statusCode).toBe(200)
      return response.json()
    }

    expect(await enter(first)).toMatchObject({ status: 'WAITING' })
    const matched = await enter(second)
    expect(matched.status).toBe('MATCHED')
    const roomId = matched.roomId as string

    // 아직 아무도 접속하지 않았으므로 폴링은 시작시키지 않는다.
    const tooEarly = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/quick-matches',
      headers: h.authHeaders(first),
    })
    expect(tooEarly.json()).toMatchObject({ status: 'MATCHED' })

    const clients = [
      await h.joined(url, { ...first, room_id: roomId }),
      await h.joined(url, { ...second, room_id: roomId }),
    ]
    const polled = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/quick-matches',
      headers: h.authHeaders(first),
    })

    expect(polled.json()).toMatchObject({ status: 'PLAYING', roomId })
    // 시작은 라이프사이클 → 듀얼 모듈까지 내려간다(같은 레지스트리·같은 모듈 등록).
    await clients[0]?.await('game.duel.state')
    expect(instance.registry.phaseOf(roomId)).toBe('playing')

    for (const client of clients) client.socket.close()
  })

  /**
   * **(f) 고아 라운드 상태 스위퍼(2.8)가 `h.listen()`에서 돌기 시작한다.**
   *
   * 5분을 기다리지 않으려고 주기 실행 시임을 주입한다(`SweepScheduler` — 2.8이
   * 이 목적으로 남긴 자리). 확인하는 것은 셋이다: `createServer`만으로는 걸리지
   * 않는다 · `h.listen()`이 5분 주기로 건다 · 발화하면 **서버의** 라운드 저장소에서
   * 고아가 사라진다 · `close()`가 해제한다.
   */
  it('h.listen()이 고아 상태 스위퍼를 걸고 close()가 해제한다', async () => {
    const tasks: (() => void)[] = []
    const intervals: number[] = []
    let stopped = 0
    const scheduler: SweepScheduler = {
      every: (intervalMs, task): SweepSchedule => {
        intervals.push(intervalMs)
        tasks.push(task)
        return { stop: () => (stopped += 1) }
      },
    }

    const instance = await h.build({}, { sweepScheduler: scheduler })
    expect(tasks).toHaveLength(0)
    await h.listen(instance)
    expect(intervals).toEqual([SWEEP_INTERVAL_MS])

    // 방이 없는 라운드 상태 = 고아. Redis 저장소부터는 재시작이 이것을 치워 주지 않는다.
    await instance.rounds.synchronization.initialize('GHOST1', 1, ['ghost'])
    expect(await instance.rounds.states.findByRoomId('GHOST1')).toBeDefined()

    tasks[0]?.()
    await expect
      .poll(() => instance.rounds.states.findByRoomId('GHOST1'), { timeout: 2_000 })
      .toBeUndefined()

    await instance.close()
    h.release()
    expect(stopped).toBe(1)
  })

  /**
   * **(h) 이탈 경로가 `timer.removePlayer`까지 닿는다.**
   *
   * 웨이브 2 배선이 "미연결"로 남긴 항목이지만, **게임 모듈 등록만으로 연결된다**:
   * `ws/handler.ts`의 `room.leave`가 phase playing일 때 `games.byCode(...).removePlayer`를
   * 부르고, 야추 모듈이 그것을 `timers.removePlayer`로 넘긴다. 턴 순서에서 실제로
   * 빠지는 것은 타이머만 하는 일이라 그 관측이 판정 기준이다.
   */
  it('WS room.leave가 게임 모듈을 통해 턴 순서에서 빼낸다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const guest = await h.enterRoom(instance, { nickname: '참가자', room_id: host.room_id })
    const hostClient = await h.joined(url, host)
    const guestClient = await h.joined(url, { ...guest, room_id: host.room_id })
    await h.startGame(instance, host)

    const before = await instance.rounds.states.findByRoomId(host.room_id)
    expect(before?.participantOrder).toContain(guest.id)

    guestClient.send({ type: 'room.leave', ts: Date.now(), payload: {} })

    const left = await hostClient.await('room.player_left')
    expect(left).toMatchObject({ payload: { playerId: guest.id } })
    await expect
      .poll(
        async () =>
          (await instance.rounds.states.findByRoomId(host.room_id))?.participantOrder ?? [],
        { timeout: 2_000 },
      )
      .toEqual([host.id])

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /**
   * 점수 파이프라인이 **서버와 같은 Redis**에 붙어 있는지. `RedisScoreBoardStore`는
   * `defineCommand`로 CONFIRM_SCORE Lua를 자기 클라이언트에 등록하므로, 다른 연결을
   * 잡고 있으면 여기서 바로 드러난다.
   */
  it('점수 확정 서비스가 서버의 Redis에 붙어 있다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    // CONFIRM_SCORE Lua가 game:{id} ↔ 방 명단을 양방향으로 검증하므로 진짜 게임이 필요하다.
    const client = await h.joined(url, host)
    const gameId = await h.startGame(instance, host)

    expect(await instance.rounds.scores.openCategories(gameId, host.id)).toHaveLength(12)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    const open = await instance.rounds.scores.openCategories(gameId, host.id)
    expect(open).toHaveLength(11)
    expect(open).not.toContain('ones')
    // 점수판은 서버가 재계산한다 — 클라이언트 점수는 와이어에 존재하지도 않는다.
    expect((await instance.rounds.scores.scoreBoard(gameId, host.id)).categories.ones).toBe(3)

    client.socket.close()
  })

  /** `close()`가 마감 스케줄러를 멈추지 않으면 남은 타이머가 닫힌 Redis를 두드린다. */
  it('close()가 라운드 마감 스케줄러를 멈춘다', async () => {
    const instance = await h.build()
    let fired = false

    instance.rounds.deadlines.schedule('ROOM01', 1, Date.now() + 60, () => {
      fired = true
    })
    await instance.close()
    h.release()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(fired).toBe(false)
  })

  /**
   * 소셜 로그인 라우트가 실제로 등록됐는지. 미설정 제공자는 **404가 아니라 503**이
   * 계약이므로(auth.md), 이 구분이 곧 "배선됐는가"의 판정이 된다.
   */
  it('소셜 로그인 라우트가 등록되어 있다', async () => {
    const instance = await h.build()

    // 설정이 비어 있어도 라우트는 있다 — 없으면 404가 나온다.
    const unconfigured = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/authorize',
    })
    expect(unconfigured.statusCode).toBe(503)

    // 세션 교환·확인·로그아웃은 MySQL을 타지 않는다(Redis만).
    const exchange = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/session',
      payload: { code: 'no-such-code' },
    })
    expect(exchange.statusCode).toBe(401)
    expect(exchange.body).toBe('invalid_login_code')

    const me = await instance.app.inject({ method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(401)
    expect(me.body).toBe('session_expired')

    const logout = await instance.app.inject({ method: 'DELETE', url: '/api/v1/auth/session' })
    expect(logout.statusCode).toBe(204)
  })

  it('설정된 제공자의 authorize는 제공자로 302한다', async () => {
    const instance = await h.build({
      KAKAO_CLIENT_ID: 'rest-api-key',
      KAKAO_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/kakao/callback',
    })

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/kakao/authorize',
    })

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.origin + location.pathname).toBe('https://kauth.kakao.com/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('rest-api-key')
    // state는 Redis에 실제로 발급돼 있어야 한다(스토어가 서버의 Redis에 붙었다는 증거).
    const state = location.searchParams.get('state')
    expect(await redis().exists(`auth:oauth-state:${state}`)).toBe(1)
  })

  /**
   * 기동 경로는 MySQL을 **건드리지 않는다**. `verifyMigrations`가 `h.listen()`에 들어가면
   * DB 없는 개발·CI 환경에서 WS 통합 테스트가 전부 깨진다(그래서 `main.ts`에 있다).
   *
   * 그러나 **readiness는 MySQL을 요구한다**(PR 1). 기동과 준비가 다른 사건이라는 것이
   * 이 두 단정의 요점이다: 닿지 않는 MySQL을 가리켜도 리슨은 성공하고, 같은 상태에서
   * `/actuator/health`는 503을 낸다. 그래서 배포 게이트가 반쯤 죽은 인스턴스를
   * 성공으로 읽지 않는다.
   */
  it('h.listen()은 MySQL을 요구하지 않지만 readiness는 요구한다', async () => {
    const instance = await h.build({ DB_URL: 'jdbc:mysql://127.0.0.1:1/none' })

    await expect(h.listen(instance)).resolves.toContain('ws://127.0.0.1:')

    const health = await instance.app.inject({ method: 'GET', url: '/actuator/health' })
    expect(health.statusCode).toBe(503)
    expect(health.json()).toEqual({ status: 'DOWN' })
  })

  /**
   * readiness가 **그** Redis·MySQL을 받았는지 본다. 새 클라이언트를 만들어 넘기면
   * 애플리케이션이 쓰지 않는 좌표를 검사하게 되고, 그때 health는 아무것도 증명하지
   * 않는다 — 게이지 배선과 같은 종류의 조용한 실패다.
   *
   * MySQL은 이 환경에 없으므로 `SELECT 1`에 응답하는 풀 대역을 주입한다: readiness가
   * 주입받은 풀을 실제로 두드리면(=배선이 살아 있으면) 질의가 관측되고 판정이 UP이 된다.
   */
  it('readiness가 주입받은 Redis·MySQL을 실제로 두드린다', async () => {
    const mysql = h.mysqlDouble()
    const instance = await h.build({}, { mysql: mysql.pool })

    const health = await instance.app.inject({ method: 'GET', url: '/actuator/health' })

    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'UP' })
    expect(mysql.queries).toContain('SELECT 1')
  })

  /**
   * 메트릭 수집기가 **그** 레지스트리를 받았는지 본다. 새 `RoomSessionRegistry`를
   * 넘기면 게이지가 영구히 0인데 타입도 단위 테스트도 통과한다 — 배선 누락 여섯 번째
   * 자리다. 배선을 아예 빼면 `/actuator/prometheus`가 503이 되어 여기서 깨진다.
   */
  it('메트릭 게이지가 실제 방·소켓을 센다', async () => {
    const instance = await h.build()
    const url = await h.listen(instance)
    const host = await h.enterRoom(instance, { nickname: '호스트' })
    const client = await h.joined(url, host)
    await h.startGame(instance, host)

    const response = await instance.app.inject({ method: 'GET', url: '/actuator/prometheus' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('yorr_rooms_active 1')
    expect(response.body).toContain('yorr_game_participants_active{game="YACHT_DICE"} 1')

    client.socket.close()
  })
})
