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

export function useLobbyRoom(roomId: string) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const snapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const connectionStatus = useAppStore((state) => state.connectionStatus)

  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && isRoomHost(snapshot, roomSession.you)
  const capacity = snapshot?.capacity ?? 6
  const gameCode =
    snapshot?.gameCode ?? (matchingRoom ? roomSession.gameCode : undefined) ?? 'YACHT_DICE'
  // 시작 인원·봇 지원은 게임마다 다르고 서버 카탈로그가 판정한다 — 화면은 같은 표
  // (`games.ts`)를 읽는다. "2인 게임인가"로 대신 갈랐더니 2~4인이지만 봇이 없는
  // 다빈치 코드에서 봇 패널이 켜지고 혼자서도 시작 버튼이 켜져, 둘 다 서버 오류 문구로 끝났다.
  const { minPlayers, supportsBots } = gameByCode(gameCode)
  const duoGame = isDuoGame(gameCode)
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
    gameCode,
    isHost,
    minPlayers,
    session: matchingRoom && !roomResumeReason ? roomSession : null,
    snapshot,
    supportsBots,
  }
}
