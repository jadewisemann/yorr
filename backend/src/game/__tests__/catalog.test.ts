import { describe, expect, it } from 'vitest'
import { DomainError } from '../../errors.js'
import { GameCatalog } from '../catalog.js'

describe('GameCatalog', () => {
  const catalog = new GameCatalog()

  it('세 게임의 정원·시작 인원·봇 지원 여부를 안다', () => {
    expect(catalog.require('YACHT_DICE')).toMatchObject({
      minPlayers: 1,
      maxPlayers: 6,
      supportsBots: true,
    })
    expect(catalog.require('DUEL')).toMatchObject({
      minPlayers: 2,
      maxPlayers: 2,
      supportsBots: false,
    })
    expect(catalog.require('PING_PONG')).toMatchObject({
      minPlayers: 2,
      maxPlayers: 2,
      supportsBots: false,
    })
  })

  it('대소문자·공백을 관용하고 정규화된 코드를 돌려준다', () => {
    expect(catalog.canonicalCode(' yacht_dice ')).toBe('YACHT_DICE')
  })

  it('모르는 코드는 invalid_game_code다', () => {
    expect(() => catalog.require('CHESS')).toThrow(new DomainError('invalid_game_code'))
    expect(() => catalog.require(null)).toThrow(new DomainError('invalid_game_code'))
  })

  it('같은 코드를 두 번 등록하면 조립 시점에 막는다', () => {
    const duplicate = { code: 'X', name: 'X', minPlayers: 1, maxPlayers: 2, supportsBots: false }
    expect(() => new GameCatalog([duplicate, duplicate])).toThrow('duplicate_game_code')
  })
})
