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

/**
 * 진행·결과 화면을 스스로 들고 있는 게임들. 이 게임들의 진행 상태는 WebSocket으로만 오므로
 * 아래의 방 진행 REST(useGame)를 타지 않는다 — 야추만 그 경로를 쓴다.
 */
const moduleScreens = {
  DUEL: {
    Game: lazy(() =>
      import('@/duel/screens/DuelGame').then((module) => ({ default: module.DuelGame })),
    ),
    Result: lazy(() =>
      import('@/duel/screens/DuelGame').then((module) => ({ default: module.DuelResult })),
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

/**
 * 결과 화면을 덮는 전환 시간. 결과 계산을 기다리는 게 아니라 — 값은 이미 스냅샷에 있다 —
 * 마지막 프레임에서 화면이 통째로 튀지 않게 하는 연출값이다. 게임과 무관하게 같은 값을
 * 쓴다(야추의 주사위, 탁구의 마지막 랠리).
 *
 * ponytail: 고정 상수다. 종료 연출이 길어지면 여기도 같이 올린다.
 */
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

  // 진행 상태(game)는 WebSocket state.sync로도 오지만, 새로고침·직접 진입에 대비해 한 번 받아둔다.
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
      {/* 대기실 → 게임 전환과 같은 오버레이. 덮는 동안 진행 화면이 그대로 살아 있어
          마지막 프레임이 스크림 뒤에 남는다. 게임 종류와 무관하게 같은 층이다. */}
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
