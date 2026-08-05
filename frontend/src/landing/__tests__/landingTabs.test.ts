import { describe, expect, it } from 'vitest'
import { games } from '@/games'
import { gameMeta, LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'

describe('탭 접근성 id', () => {
  it('tab id는 게임 키에서 파생되고 panel id는 하나로 고정된다', () => {
    expect(landingTabId('yacht')).toBe('landing-tab-yacht')
    expect(LANDING_PANEL_ID).toBe('landing-game-panel')
  })
})

describe('gameMeta', () => {
  it('인원과 소요 시간을 가운뎃점으로 잇는다', () => {
    expect(gameMeta(games[0])).toBe('1–6 PLAYERS · 약 15분')
  })
})
