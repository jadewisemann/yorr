import { describe, expect, it } from 'vitest'
import { DomainError } from '../../errors.js'
import type { InboundEnvelope } from '../../ws/envelope.js'
import type { ClientSocket } from '../../ws/socket.js'
import { DUEL, GameCatalog, YACHT_DICE } from '../catalog.js'
import { type GameModule, GameModuleRegistry, gameWsType } from '../module.js'

/** backend-java `GameModuleRegistryTest`의 `mock(GameModule.class)` 자리. */
interface FakeModule {
  readonly module: GameModule
  readonly handled: { socket: ClientSocket; message: InboundEnvelope }[]
}

const fakeModule = (code: string, events: string[] = ['dice.roll']): FakeModule => {
  const handled: { socket: ClientSocket; message: InboundEnvelope }[] = []
  const module: GameModule = {
    code,
    start: async () => {},
    reset: async () => {},
    reconnect: async (roomCode) => ({ roomId: roomCode, phase: 'playing', players: [] }),
    pause: async () => {},
    resume: async () => {},
    removePlayer: async () => {},
    close: async () => {},
    hasState: async () => false,
    handles: (eventType) => events.includes(eventType),
    handle: async (socket, message) => {
      handled.push({ socket, message })
    },
  }
  return { module, handled }
}

const socket: ClientSocket = { readyState: 1, send: () => {}, close: () => {} }

const inbound = (type: string, msgId: string): InboundEnvelope => ({
  type,
  ts: 1,
  payload: null,
  roomId: 'ROOM',
  msgId,
})

describe('GameModuleRegistry', () => {
  it('게임 코드를 정규화해 찾고 모르는 코드는 invalid_game_code다', () => {
    const registry = new GameModuleRegistry()
    registry.register(fakeModule(YACHT_DICE).module)

    expect(registry.canonicalCode(' yacht_dice ')).toBe('YACHT_DICE')
    expect(registry.byCode(' yacht_dice ')?.code).toBe('YACHT_DICE')
    expect(() => registry.require('unknown')).toThrow(new DomainError('invalid_game_code'))
  })

  /** 정원·시작 인원·봇 지원은 모듈이 아니라 카탈로그가 들고 있다 — 값이 갈라지지 않는다. */
  it('메타데이터는 등록 여부와 무관하게 카탈로그에서 나온다', () => {
    const registry = new GameModuleRegistry()

    expect(registry.require(' duel ')).toMatchObject({
      code: 'DUEL',
      minPlayers: 2,
      maxPlayers: 2,
      supportsBots: false,
    })
    expect(registry.byCode(DUEL)).toBeUndefined()
    expect(registry.supportedCodes()).toContain('PING_PONG')
  })

  it('접두사가 맞는 메시지만 접두사를 벗겨 넘긴다', async () => {
    const registry = new GameModuleRegistry()
    const yacht = fakeModule(YACHT_DICE)
    registry.register(yacht.module)

    const namespaced = inbound('game.yacht_dice.dice.roll', 'msg-1')
    expect(await registry.dispatch(YACHT_DICE, socket, namespaced)).toBe(true)
    expect(yacht.handled).toEqual([
      {
        socket,
        message: { type: 'dice.roll', ts: 1, payload: null, roomId: 'ROOM', msgId: 'msg-1' },
      },
    ])

    // 접두사 없는 원시 이벤트명은 라우팅되지 않는다.
    expect(await registry.dispatch(YACHT_DICE, socket, inbound('dice.roll', 'msg-2'))).toBe(false)
    // 다른 게임 네임스페이스는 거부한다(등록되지 않은 코드든 등록된 코드든).
    expect(
      await registry.dispatch(YACHT_DICE, socket, inbound('game.omok.dice.roll', 'msg-3')),
    ).toBe(false)
    expect(
      await registry.dispatch(YACHT_DICE, socket, inbound('game.duel.dice.roll', 'msg-4')),
    ).toBe(false)
    // 모듈이 모르는 이벤트도 거부한다.
    expect(await registry.dispatch(YACHT_DICE, socket, inbound('game.yacht_dice.x', 'msg-5'))).toBe(
      false,
    )
    expect(yacht.handled).toHaveLength(1)
  })

  /**
   * 모듈이 아직 없는 게임 코드는 **던지지 않고** false다(Java는 `require()`가
   * `invalid_game_code`를 던진다) — 야추 모듈이 붙기 전까지 그 방의 대기실 자체가
   * 돌아가야 하고, 게이트웨이는 이 false를 `INVALID_MESSAGE`로 답한다.
   */
  it('모듈이 없는 게임 코드는 던지지 않고 처리하지 않았다고 답한다', async () => {
    const registry = new GameModuleRegistry()

    expect(await registry.dispatch(DUEL, socket, inbound('game.duel.move', 'msg-1'))).toBe(false)
    expect(await registry.dispatch(null, socket, inbound('game.duel.move', 'msg-2'))).toBe(false)
    expect(await registry.dispatch('CHESS', socket, inbound('game.chess.move', 'msg-3'))).toBe(
      false,
    )
  })

  it('같은 코드 중복 등록과 카탈로그에 없는 코드는 기동 시점에 막는다', () => {
    const registry = new GameModuleRegistry()
    registry.register(fakeModule(YACHT_DICE).module)

    expect(() => registry.register(fakeModule(' yacht_dice ').module)).toThrow(
      'duplicate_game_code',
    )
    expect(() => registry.register(fakeModule('CHESS').module)).toThrow(
      new DomainError('invalid_game_code'),
    )
    expect(registry.all()).toHaveLength(1)
  })

  it('카탈로그 인스턴스를 공유받아 같은 표를 쓴다', () => {
    const catalog = new GameCatalog([
      { code: 'SOLO', name: 'Solo', minPlayers: 1, maxPlayers: 1, supportsBots: false },
    ])
    const registry = new GameModuleRegistry(catalog)
    registry.register(fakeModule('SOLO').module)

    expect(registry.require('solo').maxPlayers).toBe(1)
    expect(() => registry.require(YACHT_DICE)).toThrow(new DomainError('invalid_game_code'))
  })
})

describe('gameWsType', () => {
  it('아웃바운드 타입은 game.<코드소문자>.<이벤트>다', () => {
    expect(gameWsType(YACHT_DICE, 'round.start')).toBe('game.yacht_dice.round.start')
    expect(gameWsType(YACHT_DICE, 'game.over')).toBe('game.yacht_dice.game.over')
  })

  it('코드나 이벤트가 비면 invalid_game_event_type이다', () => {
    expect(() => gameWsType('', 'round.start')).toThrow(new DomainError('invalid_game_event_type'))
    expect(() => gameWsType(YACHT_DICE, ' ')).toThrow(new DomainError('invalid_game_event_type'))
    expect(() => gameWsType(null, 'round.start')).toThrow(
      new DomainError('invalid_game_event_type'),
    )
  })
})
