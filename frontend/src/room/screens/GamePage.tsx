import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { GameCode } from '@/games'
import { useGame } from '@/room/api/useGameApi'
import { playGameSoundtrack, playResultSoundtrack } from '@/shared/audio/soundtrack'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { useAppStore } from '@/store'
import { GamePlay } from '@/yacht/screens/GamePlay'
import { GameResult } from '@/yacht/screens/GameResult'
import { RoomExitGuard } from './RoomExitGuard'

const moduleScreens = {
  DUEL: {
    Game: lazy(() =>
      import('@/duel/screens/DuelGame').then((module) => ({ default: module.DuelGame })),
    ),
    Result: lazy(() =>
      import('@/duel/screens/DuelResult').then((module) => ({ default: module.DuelResult })),
    ),
  },
  PING_PONG: {
    Game: lazy(() =>
      import('@/pingpong/screens/PingPongGame').then((module) => ({
        default: module.PingPongGame,
      })),
    ),
    Result: lazy(() =>
      import('@/pingpong/screens/PingPongResult').then((module) => ({
        default: module.PingPongResult,
      })),
    ),
  },
}

function screensOf(gameCode: GameCode | undefined) {
  return gameCode === 'DUEL' || gameCode === 'PING_PONG' ? moduleScreens[gameCode] : null
}

const RESULT_TRANSITION_MS = 1_000

export function GamePage({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const [exitRequested, setExitRequested] = useState(false)
  const [resultReady, setResultReady] = useState(false)
  const matchingRoom = roomSession?.roomId === roomId
  const screens = screensOf(roomSnapshot?.gameCode ?? roomSession?.gameCode)
  const gameCode = roomSnapshot?.gameCode ?? roomSession?.gameCode
  const finished = roomSnapshot?.phase === 'finished'

  useEffect(() => {
    if (!finished) {
      setResultReady(false)
      return
    }
    const timeoutId = window.setTimeout(() => setResultReady(true), RESULT_TRANSITION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [finished])

  useGame(matchingRoom && !screens ? roomSession.gameId : null)

  useEffect(() => {
    if (roomSnapshot?.phase === 'finished') playResultSoundtrack()
    else if (roomSnapshot?.phase === 'playing') playGameSoundtrack(gameCode)
  }, [gameCode, roomSnapshot?.phase])

  useEffect(() => {
    if (!roomSession || !roomSnapshot || !matchingRoom || roomResumeReason) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot.phase === 'waiting') {
      void navigate({
        to: '/rooms/$roomId/lobby',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  if (!roomSession || !roomSnapshot || !matchingRoom || roomResumeReason) return null

  return (
    <>
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      <LoadingOverlay message="결과를 정리하고 있어요" open={finished && !resultReady} />
      {screens && finished && resultReady ? (
        <Suspense fallback={null}>
          <screens.Result
            onLeaveRequest={() => setExitRequested(true)}
            session={roomSession}
            snapshot={roomSnapshot}
          />
        </Suspense>
      ) : screens ? (
        <Suspense fallback={null}>
          <screens.Game
            onLeaveRequest={() => setExitRequested(true)}
            roomId={roomId}
            session={roomSession}
            snapshot={roomSnapshot}
          />
        </Suspense>
      ) : finished && resultReady ? (
        <GameResult
          onLeaveRequest={() => setExitRequested(true)}
          session={roomSession}
          snapshot={roomSnapshot}
        />
      ) : (
        <GamePlay
          onLeaveRequest={() => setExitRequested(true)}
          roomId={roomId}
          session={roomSession}
          snapshot={roomSnapshot}
        />
      )}
    </>
  )
}
