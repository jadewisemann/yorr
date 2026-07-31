import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayingRoomSnapshot, creatorSession, waitingRoomSnapshot } from '@/mocks/fixtures'
import { readRoomSession } from '@/roomSessionStorage'
import { selectSessionPhase, useAppStore } from '@/store'

beforeEach(() => {
  window.localStorage.clear()
  useAppStore.getState().reset()
})

afterEach(() => {
  window.localStorage.clear()
  useAppStore.getState().reset()
  vi.resetModules()
})

describe('appNotice·connectionStatus', () => {
  it('안내와 연결 상태는 서로 독립적으로 바뀐다', () => {
    useAppStore.getState().setAppNotice('연결이 불안정해요.')
    useAppStore.getState().setConnectionStatus('reconnecting')

    expect(useAppStore.getState()).toMatchObject({
      appNotice: '연결이 불안정해요.',
      connectionStatus: 'reconnecting',
      roomSession: null,
    })
  })
})

describe('setRoomSession', () => {
  it('세션은 저장소에 남기고 스토어에는 스냅샷과 분리해 담는다', () => {
    useAppStore.getState().setAppNotice('낡은 안내')

    useAppStore.getState().setRoomSession(creatorSession)

    const state = useAppStore.getState()
    expect(state.appNotice).toBeNull()
    expect(state.roomResumeReason).toBeNull()
    expect(state.roomSession).not.toHaveProperty('snapshot')
    expect(state.roomSnapshot).toEqual(waitingRoomSnapshot)
    expect(readRoomSession()).toEqual(creatorSession)
  })
})

describe('replaceRoomSnapshot', () => {
  it('세션이 있으면 저장소의 스냅샷까지 함께 갱신한다', () => {
    useAppStore.getState().setRoomSession(creatorSession)
    const playing = createPlayingRoomSnapshot(9_999)

    useAppStore.getState().replaceRoomSnapshot(playing)

    expect(useAppStore.getState().roomSnapshot).toEqual(playing)
    expect(readRoomSession()?.snapshot).toEqual(playing)
  })

  it('세션이 없거나 스냅샷을 비울 때는 저장소를 건드리지 않는다', () => {
    useAppStore.getState().replaceRoomSnapshot(waitingRoomSnapshot)
    expect(readRoomSession()).toBeNull()

    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().replaceRoomSnapshot(null)

    expect(useAppStore.getState().roomSnapshot).toBeNull()
    // 새로고침 복구를 위해 저장된 세션은 살아 있어야 한다.
    expect(readRoomSession()).not.toBeNull()
  })
})

describe('endSession', () => {
  it('연결 끊김은 토큰을 지우지 않고 복귀 확인 상태로 멈춘다', () => {
    useAppStore.getState().setRoomSession(creatorSession)

    useAppStore.getState().endSession('disconnected')

    const state = useAppStore.getState()
    expect(state.roomSession).not.toBeNull()
    expect(state.connectionStatus).toBe('closed')
    expect(state.roomResumeReason).toBe('disconnected')
    expect(state.appNotice).toContain('연결이 계속 끊겼어요')
    expect(readRoomSession()).not.toBeNull()
  })

  it('퇴장·방 종료·만료는 세션과 저장소를 함께 비우고 이유별 안내를 남긴다', () => {
    const notices = ['left', 'room_closed', 'expired'].map((reason) => {
      useAppStore.getState().setRoomSession(creatorSession)
      useAppStore.getState().endSession(reason as 'left' | 'room_closed' | 'expired')
      const state = useAppStore.getState()
      expect(state.roomSession).toBeNull()
      expect(state.roomSnapshot).toBeNull()
      expect(state.connectionStatus).toBe('idle')
      expect(readRoomSession()).toBeNull()
      return state.appNotice
    })

    // 스스로 나간 경우에만 안내를 띄우지 않는다.
    expect(notices[0]).toBeNull()
    expect(notices[1]).toContain('방이 종료되어')
    expect(notices[2]).toContain('만료됐어요')
  })
})

describe('resumeRoomSession', () => {
  it('복귀를 고르면 안내와 복귀 사유를 함께 지운다', () => {
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().endSession('disconnected')

    useAppStore.getState().resumeRoomSession()

    expect(useAppStore.getState()).toMatchObject({ appNotice: null, roomResumeReason: null })
  })
})

describe('selectSessionPhase', () => {
  it('세션·스냅샷 조합에서 FSM 상태를 파생한다', () => {
    expect(selectSessionPhase(useAppStore.getState())).toBe('idle')

    useAppStore.getState().setRoomSession({ ...creatorSession, snapshot: null })
    expect(selectSessionPhase(useAppStore.getState())).toBe('joining')

    useAppStore.getState().replaceRoomSnapshot(waitingRoomSnapshot)
    expect(selectSessionPhase(useAppStore.getState())).toBe('inLobby')

    useAppStore.getState().replaceRoomSnapshot(createPlayingRoomSnapshot(9_999))
    expect(selectSessionPhase(useAppStore.getState())).toBe('inGame')
  })
})

describe('저장소 복원', () => {
  it('저장된 세션이 있으면 자동 입장하지 않고 복귀 확인 상태로 시작한다', async () => {
    window.localStorage.setItem(
      'yorr.room-session',
      JSON.stringify({ expiresAt: Date.now() + 60_000, session: creatorSession }),
    )
    vi.resetModules()

    const { useAppStore: restoredStore } = await import('./store')

    expect(restoredStore.getState()).toMatchObject({
      roomResumeReason: 'restored',
      roomSnapshot: waitingRoomSnapshot,
    })
    expect(restoredStore.getState().roomSession).toMatchObject({
      roomId: creatorSession.roomId,
      sessionToken: creatorSession.sessionToken,
    })
    expect(restoredStore.getState().roomSession).not.toHaveProperty('snapshot')
  })
})
