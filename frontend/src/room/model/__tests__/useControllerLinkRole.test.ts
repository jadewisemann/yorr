import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { dashboardSession, participantSession } from '@/mocks/fixtures'
import { savePartyRoom } from '@/room/partyControllerStorage'
import { useAppStore } from '@/store'
import { useControllerLinkRole } from '../useControllerLinkRole'

const roleOf = () => renderHook(() => useControllerLinkRole()).result.current

describe('useControllerLinkRole', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    globalThis.localStorage.clear()
  })

  it('방에 들어오기 전에는 역할이 없다', () => {
    expect(roleOf()).toBeNull()
  })

  it('대시보드 세션은 협상을 거는 쪽이다', () => {
    useAppStore.getState().setRoomSession(dashboardSession)

    expect(roleOf()).toBe('dashboard')
  })

  it('파티 방으로 기억된 폰만 컨트롤러가 된다', () => {
    useAppStore.getState().setRoomSession(participantSession)
    expect(roleOf()).toBeNull()

    savePartyRoom(participantSession.roomCode)

    expect(roleOf()).toBe('controller')
  })

  it('다른 방 코드로 기억돼 있으면 역할이 없다', () => {
    // 플래그만 남기면 다음 일반 방까지 컨트롤러로 뜬다(room-and-session.md).
    savePartyRoom('OTHER1')
    useAppStore.getState().setRoomSession(participantSession)

    expect(roleOf()).toBeNull()
  })
})
