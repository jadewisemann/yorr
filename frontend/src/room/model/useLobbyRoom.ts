import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { gameByCode } from '@/games'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { useAppStore } from '@/store'
import { lobbyStateOf } from './lobbyState'

const PREFETCH_FALLBACK_DELAY_MS = 500

function schedulePhysicsDicePrefetch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const prefetch = () => {
    void import('@/yacht/prefetchPhysicsDice').then(({ prefetchPhysicsDice }) =>
      prefetchPhysicsDice(),
    )
  }
  const idleApi = window as unknown as {
    requestIdleCallback?: Window['requestIdleCallback']
    cancelIdleCallback?: Window['cancelIdleCallback']
  }
  if (idleApi.requestIdleCallback && idleApi.cancelIdleCallback) {
    const idleId = idleApi.requestIdleCallback(prefetch, { timeout: 2_000 })
    return () => idleApi.cancelIdleCallback?.(idleId)
  }
  const timeoutId = window.setTimeout(prefetch, PREFETCH_FALLBACK_DELAY_MS)
  return () => window.clearTimeout(timeoutId)
}

export function useLobbyRoom(roomId: string) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const snapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const connectionStatus = useAppStore((state) => state.connectionStatus)

  const lobby = lobbyStateOf({ connectionStatus, roomId, roomResumeReason, roomSession, snapshot })
  const { matchingRoom, inWaitingRoom, duoGame } = lobby

  useEffect(() => {
    if (inWaitingRoom && snapshot) playLandingSoundtrack(gameByCode(snapshot.gameCode).key)
    leaveLobbyIfStale({ matchingRoom, navigate, roomResumeReason, roomSession })
    enterGameIfStarted({ inWaitingRoom, navigate, roomSession, snapshot })
  }, [inWaitingRoom, matchingRoom, navigate, roomResumeReason, roomSession, snapshot])

  useEffect(() => {
    if (!matchingRoom || !inWaitingRoom || duoGame) return
    return schedulePhysicsDicePrefetch()
  }, [duoGame, inWaitingRoom, matchingRoom])

  return lobby
}

/** 세션이 없거나 다시 이어 붙일 수 없으면 랜딩으로 돌려보낸다. */
function leaveLobbyIfStale(options: {
  matchingRoom: boolean
  navigate: ReturnType<typeof useNavigate>
  roomResumeReason: unknown
  roomSession: ReturnType<typeof useAppStore.getState>['roomSession']
}) {
  const { matchingRoom, navigate, roomResumeReason, roomSession } = options
  if (roomSession && matchingRoom && !roomResumeReason) return
  void navigate({ to: '/', replace: true })
}

/** 방이 대기실을 벗어났으면 게임 화면으로 넘긴다. */
function enterGameIfStarted(options: {
  inWaitingRoom: boolean
  navigate: ReturnType<typeof useNavigate>
  roomSession: ReturnType<typeof useAppStore.getState>['roomSession']
  snapshot: ReturnType<typeof useAppStore.getState>['roomSnapshot']
}) {
  const { inWaitingRoom, navigate, roomSession, snapshot } = options
  if (!snapshot || inWaitingRoom || !roomSession) return
  void navigate({
    to: '/rooms/$roomId/game',
    params: { roomId: roomSession.roomId },
    replace: true,
  })
}
