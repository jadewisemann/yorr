import { describe, expect, it } from 'vitest'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { sessionPhaseOf, sessionScreenOf } from '@/room/sessionFsm'

const session = { roomId: 'YORR64' }

function snapshot(phase: RoomSnapshot['phase'], roomId = 'YORR64'): RoomSnapshot {
  return { roomId, phase, players: [] }
}

describe('sessionPhaseOf', () => {
  it('세션이 없으면 idle', () => {
    expect(sessionPhaseOf(null, null)).toBe('idle')
    expect(sessionPhaseOf(null, snapshot('waiting'))).toBe('idle')
  })

  it('세션은 있는데 스냅샷이 아직 없으면 joining', () => {
    expect(sessionPhaseOf(session, null)).toBe('joining')
  })

  it('다른 방의 스냅샷은 무시하고 joining으로 본다', () => {
    expect(sessionPhaseOf(session, snapshot('playing', 'OTHER1'))).toBe('joining')
  })

  it('스냅샷 phase를 따라 inLobby → inGame → finished로 전이한다', () => {
    expect(sessionPhaseOf(session, snapshot('waiting'))).toBe('inLobby')
    expect(sessionPhaseOf(session, snapshot('playing'))).toBe('inGame')
    expect(sessionPhaseOf(session, snapshot('finished'))).toBe('finished')
  })
})

describe('sessionScreenOf', () => {
  it('idle이면 홈', () => {
    expect(sessionScreenOf('idle')).toBe('home')
  })

  it('joining·inLobby는 대기실, inGame·finished는 게임 화면', () => {
    expect(sessionScreenOf('joining')).toBe('lobby')
    expect(sessionScreenOf('inLobby')).toBe('lobby')
    expect(sessionScreenOf('inGame')).toBe('game')
    expect(sessionScreenOf('finished')).toBe('game')
  })
})
