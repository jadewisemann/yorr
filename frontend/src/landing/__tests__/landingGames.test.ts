import { describe, expect, it } from 'vitest'
import {
  gameMeta,
  LANDING_PANEL_ID,
  landingGameAt,
  landingGames,
  landingTabId,
} from '@/landing/landingGames'

describe('landingGames', () => {
  it('첫 게임은 실제로 플레이할 수 있는 요트 다이스다', () => {
    expect(landingGames[0]).toMatchObject({ key: 'yacht', live: true })
  })

  it('준비 중인 게임은 live=false로만 구분한다', () => {
    expect(landingGames.filter((game) => game.live)).toHaveLength(1)
  })

  it('게임 키는 중복되지 않는다 — 탭 id가 키로 만들어진다', () => {
    const keys = landingGames.map((game) => game.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('landingGameAt', () => {
  it('인덱스로 게임을 고른다', () => {
    expect(landingGameAt(1)).toBe(landingGames[1])
  })

  it('범위를 벗어난 인덱스는 첫 게임으로 떨어진다', () => {
    // 히어로 씬은 항상 무언가를 그려야 한다 — undefined가 새면 캔버스가 비어 버린다.
    expect(landingGameAt(landingGames.length)).toBe(landingGames[0])
    expect(landingGameAt(-1)).toBe(landingGames[0])
  })
})

describe('탭 접근성 id', () => {
  it('tab id는 게임 키에서 파생되고 panel id는 하나로 고정된다', () => {
    expect(landingTabId('yacht')).toBe('landing-tab-yacht')
    expect(LANDING_PANEL_ID).toBe('landing-game-panel')
  })
})

describe('gameMeta', () => {
  it('인원과 소요 시간을 가운뎃점으로 잇는다', () => {
    expect(gameMeta(landingGames[0])).toBe('1–6 PLAYERS · 약 15분')
  })
})
