import { describe, expect, it } from 'vitest'
import { type GameModule, GameModuleRegistry } from '../module.js'

const stubModule = (code: string, prefix: string): GameModule => ({
  code,
  name: code,
  minPlayers: 1,
  maxPlayers: 6,
  supportsBots: true,
  start: async () => {},
  reset: async () => {},
  resume: async () => {},
  pause: async () => {},
  removePlayer: async () => {},
  close: async () => {},
  hasState: async () => false,
  reconnect: async () => ({}),
  handles: (messageType) => messageType.startsWith(prefix),
  handle: async () => {},
})

describe('GameModuleRegistry', () => {
  it('코드와 메시지 타입으로 모듈을 찾는다', () => {
    const registry = new GameModuleRegistry()
    registry.register(stubModule('yacht', 'dice.'))
    registry.register(stubModule('pingpong', 'pingpong.'))

    expect(registry.byCode('yacht')?.code).toBe('yacht')
    expect(registry.byMessageType('dice.roll')?.code).toBe('yacht')
    expect(registry.byMessageType('unknown.type')).toBeUndefined()
  })

  it('같은 코드를 중복 등록하면 던진다', () => {
    const registry = new GameModuleRegistry()
    registry.register(stubModule('yacht', 'dice.'))
    expect(() => registry.register(stubModule('yacht', 'dice.'))).toThrow()
  })
})
