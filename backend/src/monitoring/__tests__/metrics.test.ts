import { beforeEach, describe, expect, it } from 'vitest'
import { GameCatalog } from '../../game/catalog.js'
import { GameModuleRegistry } from '../../game/module.js'
import { RoomSessionRegistry } from '../../ws/registry.js'
import type { ClientSocket } from '../../ws/socket.js'
import { SOCKET_OPEN } from '../../ws/socket.js'
import { renderGauges } from '../exposition.js'
import {
  type MetricsGameCodeSource,
  type MetricsPresence,
  RealtimeGameMetrics,
} from '../realtimeGameMetrics.js'

/** 전송만 기록하는 가짜 소켓 — `ws/__tests__/*`와 같은 관용. */
const socket = (): ClientSocket => ({
  readyState: SOCKET_OPEN,
  send: () => {},
  close: () => {},
})

/** `name{tag="v"} 3` 한 줄에서 값만 뽑는다 — 계약은 이름·태그이므로 그걸로 찾는다. */
const sampleValue = (body: string, line: string): number | null => {
  const found = body
    .split('\n')
    .find((candidate) => candidate.startsWith(`${line} `) || candidate.startsWith(`${line}{`))
  if (!found) return null
  const parts = found.split(' ')
  return Number(parts[parts.length - 1])
}

describe('RealtimeGameMetrics', () => {
  let registry: RoomSessionRegistry
  let metrics: RealtimeGameMetrics

  beforeEach(() => {
    registry = new RoomSessionRegistry()
    metrics = new RealtimeGameMetrics({ presence: registry, games: new GameCatalog() })
  })

  it('아무 방도 없으면 게이지가 전부 0이고 계열은 남아 있다', () => {
    const body = metrics.render()

    expect(sampleValue(body, 'yorr_rooms_active')).toBe(0)
    expect(sampleValue(body, 'yorr_game_participants_active{game="YACHT_DICE"}')).toBe(0)
    expect(sampleValue(body, 'yorr_game_participants_active{game="DUEL"}')).toBe(0)
    expect(sampleValue(body, 'yorr_game_participants_active{game="PING_PONG"}')).toBe(0)
  })

  it('Prometheus 노출 형식이다 — HELP·TYPE 헤더를 포함한다', () => {
    const body = metrics.render()

    expect(body).toContain('# HELP yorr_rooms_active')
    expect(body).toContain('# TYPE yorr_rooms_active gauge')
    expect(body).toContain('# HELP yorr_game_participants_active')
    expect(body).toContain('# TYPE yorr_game_participants_active gauge')
    expect(body.endsWith('\n')).toBe(true)
  })

  it('대기 중인 방은 세지 않는다 — PLAYING만 active다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.join('ROOM1', socket(), 'player-1', '호스트')

    const body = metrics.render()

    expect(sampleValue(body, 'yorr_rooms_active')).toBe(0)
    expect(sampleValue(body, 'yorr_game_participants_active{game="YACHT_DICE"}')).toBe(0)
  })

  it('PLAYING 방과 라이브 소켓을 센다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    registry.join('ROOM1', socket(), 'player-1', '호스트')
    registry.join('ROOM1', socket(), 'player-2', '참가자')
    registry.markPhase('ROOM1', 'playing')
    registry.registerGame('ROOM2', 'DUEL')
    registry.join('ROOM2', socket(), 'player-3', '결투자')
    registry.markPhase('ROOM2', 'playing')

    const body = metrics.render()

    expect(sampleValue(body, 'yorr_rooms_active')).toBe(2)
    expect(sampleValue(body, 'yorr_game_participants_active{game="YACHT_DICE"}')).toBe(2)
    expect(sampleValue(body, 'yorr_game_participants_active{game="DUEL"}')).toBe(1)
    expect(sampleValue(body, 'yorr_game_participants_active{game="PING_PONG"}')).toBe(0)
  })

  /** 게이지는 pull 모델이다 — 상태가 바뀌면 다음 스크레이프에 그대로 반영돼야 한다. */
  it('오프라인 좌석은 참가자에서 빠지지만 방은 여전히 진행 중이다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    const leaving = socket()
    registry.join('ROOM1', leaving, 'player-1', '호스트')
    registry.join('ROOM1', socket(), 'player-2', '참가자')
    registry.markPhase('ROOM1', 'playing')

    registry.markOffline(leaving)
    const body = metrics.render()

    expect(sampleValue(body, 'yorr_game_participants_active{game="YACHT_DICE"}')).toBe(1)
    expect(sampleValue(body, 'yorr_rooms_active')).toBe(1)
  })

  it('재접속으로 소켓이 다시 붙으면 다시 센다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    const first = socket()
    registry.join('ROOM1', first, 'player-1', '호스트')
    registry.markPhase('ROOM1', 'playing')
    registry.markOffline(first)
    const yacht = 'yorr_game_participants_active{game="YACHT_DICE"}'
    expect(sampleValue(metrics.render(), yacht)).toBe(0)

    registry.join('ROOM1', socket(), 'player-1', '호스트')

    expect(sampleValue(metrics.render(), yacht)).toBe(1)
  })

  it('방이 비면 phase도 함께 잊혀 방 게이지가 0으로 돌아온다', () => {
    registry.registerGame('ROOM1', 'YACHT_DICE')
    const only = socket()
    registry.join('ROOM1', only, 'player-1', '호스트')
    registry.markPhase('ROOM1', 'playing')
    expect(sampleValue(metrics.render(), 'yorr_rooms_active')).toBe(1)

    registry.remove(only)

    const body = metrics.render()
    expect(sampleValue(body, 'yorr_rooms_active')).toBe(0)
    expect(sampleValue(body, 'yorr_game_participants_active{game="YACHT_DICE"}')).toBe(0)
  })

  /**
   * 배선 계약: `server.ts`가 넘길 두 인스턴스가 포트를 그대로 만족해야 한다
   * (Java도 `RoomSessionRegistry` + `GameModuleRegistry`를 주입받았다).
   */
  it('WS 레지스트리와 게임 모듈 레지스트리를 그대로 받는다', () => {
    const presence: MetricsPresence = new RoomSessionRegistry()
    const games: MetricsGameCodeSource = new GameModuleRegistry(new GameCatalog())

    const body = new RealtimeGameMetrics({ presence, games }).render()

    expect(body).toContain('yorr_rooms_active 0')
    expect(body).toContain('yorr_game_participants_active{game="PING_PONG"} 0')
  })

  /** Java `GameModuleRegistry.supportedCodes()` 자리 — 등록된 코드만 계열이 된다. */
  it('태그 값은 카탈로그의 대문자 코드다', () => {
    const body = metrics.render()

    expect(body).toContain('yorr_game_participants_active{game="YACHT_DICE"}')
    expect(body).not.toContain('game="yacht_dice"')
  })
})

describe('renderGauges', () => {
  it('태그 없는 게이지는 중괄호를 붙이지 않는다', () => {
    const body = renderGauges([{ name: 'unit_gauge', help: '도움말', samples: [{ value: 7 }] }])

    expect(body).toBe('# HELP unit_gauge 도움말\n# TYPE unit_gauge gauge\nunit_gauge 7\n')
  })

  it('태그 값의 따옴표·역슬래시·개행을 이스케이프한다', () => {
    const body = renderGauges([
      {
        name: 'unit_gauge',
        help: '줄바꿈\n포함',
        samples: [{ labels: { tag: 'a"b\\c\nd' }, value: 1 }],
      },
    ])

    expect(body).toContain('# HELP unit_gauge 줄바꿈\\n포함')
    expect(body).toContain('unit_gauge{tag="a\\"b\\\\c\\nd"} 1')
  })
})
