import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlayingRoomSnapshot, creatorSession } from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { useGame, useReturnToLobby, useStartGame } from './useGameApi'

const MOCK_GAME_ID = 'mock-game-id'

beforeEach(() => {
  useAppStore.getState().reset()
})

afterEach(() => {
  useAppStore.getState().reset()
})

describe('useGame', () => {
  it('gameId가 없으면 조회하지 않는다', async () => {
    const { result } = renderHook(() => useGame(null))

    await waitFor(() => expect(result.current.isIdle).toBe(true))
    expect(useAppStore.getState().roomSnapshot).toBeNull()
  })

  it('조회한 스냅샷을 스토어에 반영한다', async () => {
    const { result } = renderHook(() => useGame(MOCK_GAME_ID))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(useAppStore.getState().roomSnapshot).toMatchObject({
      roomId: creatorSession.roomCode,
      phase: 'playing',
    })
  })

  it('WS로 받아 둔 진행 상태는 REST 스냅샷으로 덮어쓰지 않는다', async () => {
    // 진행 상태의 SSOT는 WS(state.sync·round.start)다. REST는 방 정보만 갱신해야 한다.
    const realtimeSnapshot = createPlayingRoomSnapshot(9_999)
    useAppStore.setState({ roomSnapshot: realtimeSnapshot })

    const { result } = renderHook(() => useGame(MOCK_GAME_ID))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(useAppStore.getState().roomSnapshot?.game).toEqual(realtimeSnapshot.game)
  })

  // 응답이 날아오는 사이 game.over가 도착하면 REST의 playing이 finished를 덮어 결과 화면이
  // 영영 뜨지 않았다. 라우트 분리로 GamePage가 한 청크 늦게 마운트되면서 실제로 재현됐다.
  it('REST 응답이 늦게 도착해도 이미 끝난 게임을 진행 중으로 되돌리지 않는다', async () => {
    const playing = createPlayingRoomSnapshot(9_999)
    const finished = {
      ...playing,
      phase: 'finished' as const,
      players: playing.players.slice(0, 1),
    }
    useAppStore.setState({ roomSnapshot: finished })

    const { result } = renderHook(() => useGame(MOCK_GAME_ID))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const snapshot = useAppStore.getState().roomSnapshot
    expect(snapshot?.phase).toBe('finished')
    // 종료 뒤의 명단은 현재 접속자가 아니라 결과 화면의 이름 원본이라 함께 지킨다.
    expect(snapshot?.players).toEqual(finished.players)
  })
})

describe('useStartGame', () => {
  it('세션이 없으면 시작을 거부한다', async () => {
    const { result } = renderHook(() => useStartGame())

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.error?.message).toBe('Room session is required')
  })

  it('성공하면 gameId를 세션에 붙이고 스냅샷을 스토어에 올린다', async () => {
    useAppStore.getState().setRoomSession(creatorSession)
    const { result } = renderHook(() => useStartGame())

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.data?.gameId).toBe(MOCK_GAME_ID)
    expect(useAppStore.getState().roomSession?.gameId).toBe(MOCK_GAME_ID)
    expect(useAppStore.getState().roomSnapshot?.phase).toBe('playing')
  })
})

describe('useReturnToLobby', () => {
  it('세션이 없으면 복귀를 거부한다', async () => {
    const { result } = renderHook(() => useReturnToLobby())

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.error?.message).toBe('Room session is required')
  })

  it('복귀 요청이 성공해도 화면 전환은 서버 브로드캐스트에 맡긴다', async () => {
    useAppStore.getState().setRoomSession({
      ...creatorSession,
      snapshot: createPlayingRoomSnapshot(9_999),
    })
    const { result } = renderHook(() => useReturnToLobby())

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.isSuccess).toBe(true)
    // 스스로 대기실로 옮기면 다른 참가자와 상태가 갈린다.
    expect(useAppStore.getState().roomSnapshot?.phase).toBe('playing')
  })
})
