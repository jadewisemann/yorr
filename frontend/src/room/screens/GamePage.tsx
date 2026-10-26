import { Suspense, useState } from 'react'
import type { GameCode } from '@/games'
import {
  useFallbackGame,
  useGamePageState,
  useGameRoomGuard,
  useGameSoundtrack,
  useResultTransition,
} from '@/room/model/useGamePage'
import { LoadingOverlay } from '@/shared/components/LoadingOverlay'
import { GamePlay } from '@/yacht/screens/GamePlay'
import { GameResult } from '@/yacht/screens/GameResult'
import { screensOf } from './gameScreens'
import { RoomExitGuard } from './RoomExitGuard'

/** 게임 코드에 맞는 화면(지연 로드) 또는 야추 기본 화면. */
function GameView(options: {
  gameCode: GameCode | undefined
  finished: boolean
  resultReady: boolean
  roomId: string
  session: NonNullable<ReturnType<typeof useGamePageState>['roomSession']>
  snapshot: NonNullable<ReturnType<typeof useGamePageState>['roomSnapshot']>
  onLeaveRequest: () => void
}) {
  const { gameCode, finished, resultReady, roomId, session, snapshot, onLeaveRequest } = options
  const screens = screensOf(gameCode)

  if (screens && finished && resultReady) {
    return (
      <Suspense fallback={null}>
        <screens.Result onLeaveRequest={onLeaveRequest} session={session} snapshot={snapshot} />
      </Suspense>
    )
  }
  if (screens) {
    return (
      <Suspense fallback={null}>
        <screens.Game
          onLeaveRequest={onLeaveRequest}
          roomId={roomId}
          session={session}
          snapshot={snapshot}
        />
      </Suspense>
    )
  }
  if (finished && resultReady) {
    return <GameResult onLeaveRequest={onLeaveRequest} session={session} snapshot={snapshot} />
  }
  return (
    <GamePlay
      onLeaveRequest={onLeaveRequest}
      roomId={roomId}
      session={session}
      snapshot={snapshot}
    />
  )
}

export function GamePage({ roomId }: { roomId: string }) {
  const { matchingRoom, roomResumeReason, roomSession, roomSnapshot } = useGamePageState(roomId)
  const [exitRequested, setExitRequested] = useState(false)
  const gameCode = roomSnapshot?.gameCode ?? roomSession?.gameCode
  const finished = roomSnapshot?.phase === 'finished'
  const resultReady = useResultTransition(finished)
  const navigable = useGameRoomGuard({
    matchingRoom,
    roomResumeReason,
    roomSession,
    roomSnapshot,
  })
  const screensKnown = screensOf(gameCode) !== null
  useFallbackGame(matchingRoom, screensKnown, roomSession?.gameId ?? null)
  useGameSoundtrack(roomSnapshot?.phase, gameCode)

  if (!navigable || !roomSession || !roomSnapshot) return null

  const onLeaveRequest = () => setExitRequested(true)
  return (
    <>
      <RoomExitGuard onClose={() => setExitRequested(false)} open={exitRequested} roomId={roomId} />
      <LoadingOverlay message="결과를 정리하고 있어요" open={finished && !resultReady} />
      <GameView
        finished={finished}
        gameCode={gameCode}
        onLeaveRequest={onLeaveRequest}
        resultReady={resultReady}
        roomId={roomId}
        session={roomSession}
        snapshot={roomSnapshot}
      />
    </>
  )
}
