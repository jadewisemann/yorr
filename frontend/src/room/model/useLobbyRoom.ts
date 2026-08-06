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

/**
 * 지금 이 방의 상태 — 전부 읽기 전용 파생값이다. 화면을 옮기는 것(대기실을 벗어난 방,
 * 어긋난 세션)도 방의 상태에 딸린 일이라 여기서 한다.
 */
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
  // 파티 모드 QR로 들어온 폰. 초대 패널을 세울 자리에 연결 안내가 대신 선다 —
  // QR·링크는 큰 화면이 이미 띄우고 있어서 여기 또 있으면 자기 폰을 자기가 찍게 된다.
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
    // 방이 어긋났거나 재개 사유가 있으면 위 effect가 화면을 옮긴다 — 그때까지 그릴 것이 없다.
    session: matchingRoom && !roomResumeReason ? roomSession : null,
    snapshot,
  }
}
