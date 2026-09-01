import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { gameByCode } from '@/games'
import { isRoomHost } from '@/room/api/roomApi'
import { isDuoGame } from '@/room/domain/lobbyLabels'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { useAppStore } from '@/store'

const PREFETCH_FALLBACK_DELAY_MS = 500

function schedulePhysicsDicePrefetch() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const prefetch = () => {
    void import('@/yacht/prefetchPhysicsDice').then(({ prefetchPhysicsDice }) =>
      prefetchPhysicsDice(),
    )
  }
  // 옵셔널로 받는다 — 구형 Safari에는 없는 API라 존재를 확인해야 하고, 그 확인을
  // 위해 window 전체를 다른 타입으로 바꿔칠 이유는 없다.
  const idleApi: {
    requestIdleCallback?: Window['requestIdleCallback']
    cancelIdleCallback?: Window['cancelIdleCallback']
  } = window
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

  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && isRoomHost(snapshot, roomSession.you)
  const capacity = snapshot?.capacity ?? 6
  const duoGame =
    isDuoGame(snapshot?.gameCode) || (matchingRoom && isDuoGame(roomSession?.gameCode))
  const minPlayers = duoGame ? 2 : 1
  const controller = matchingRoom && isPartyRoom(roomSession.roomCode)

  useEffect(() => {
    if (snapshot?.phase === 'waiting') {
      playLandingSoundtrack(gameByCode(snapshot.gameCode).key)
    }
    if (!roomSession || !matchingRoom || roomResumeReason) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (snapshot && snapshot.phase !== 'waiting') {
      void navigate({
        to: '/rooms/$roomId/game',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomResumeReason, roomSession, snapshot])

  useEffect(() => {
    if (!matchingRoom || snapshot?.phase !== 'waiting' || duoGame) return
    return schedulePhysicsDicePrefetch()
  }, [duoGame, matchingRoom, snapshot?.phase])

  return {
    canStart:
      isHost &&
      connectionStatus === 'connected' &&
      snapshot?.phase === 'waiting' &&
      snapshot.players.length >= minPlayers,
    capacity,
    connectionStatus,
    controller,
    duoGame,
    gameCode: snapshot?.gameCode ?? roomSession?.gameCode ?? 'YACHT_DICE',
    isHost,
    minPlayers,
    session: matchingRoom && !roomResumeReason ? roomSession : null,
    snapshot,
  }
}
