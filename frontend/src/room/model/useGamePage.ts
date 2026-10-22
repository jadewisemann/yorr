import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { GameCode } from '@/games'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { useGame } from '@/room/api/useGameApi'
import { playGameSoundtrack, playResultSoundtrack } from '@/shared/audio/soundtrack'
import { type ActiveRoomSession, useAppStore } from '@/store'

const RESULT_TRANSITION_MS = 1_000

/**
 * 결과 화면 전환 지연. `finished`가 되면 잠시 로딩을 보여 주고 결과로 넘긴다 —
 * 마지막 점수 갱신이 화면에 남아 있는 동안 결과가 덮지 않게.
 */
export function useResultTransition(finished: boolean) {
  const [resultReady, setResultReady] = useState(false)

  useEffect(() => {
    if (!finished) {
      setResultReady(false)
      return
    }
    const timeoutId = window.setTimeout(() => setResultReady(true), RESULT_TRANSITION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [finished])

  return resultReady
}

/** 방의 phase에 맞는 배경음. 결과·진행 중에만 바꾸고 대기실은 랜딩 음악을 쓴다. */
export function useGameSoundtrack(
  phase: RoomSnapshot['phase'] | undefined,
  gameCode: GameCode | undefined,
) {
  useEffect(() => {
    if (phase === 'finished') playResultSoundtrack()
    else if (phase === 'playing') playGameSoundtrack(gameCode)
  }, [gameCode, phase])
}

interface GameRoomGuardOptions {
  matchingRoom: boolean
  roomSession: ActiveRoomSession | null
  roomSnapshot: RoomSnapshot | null
  roomResumeReason: unknown
}

/**
 * 게임 화면에 머물 자격이 있는가. 세션이 없거나 방이 다르거나 재입장을 기다리는
 * 중이면 랜딩으로, 방이 대기실로 돌아갔으면 대기실로 보낸다.
 */
export function useGameRoomGuard(options: GameRoomGuardOptions) {
  const navigate = useNavigate()
  const { matchingRoom, roomSession, roomSnapshot, roomResumeReason } = options

  useEffect(() => {
    const destination = gameDestination({
      matchingRoom,
      roomResumeReason,
      roomSession,
      roomSnapshot,
    })
    goToDestination(navigate, destination)
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  return Boolean(roomSession && roomSnapshot && matchingRoom && !roomResumeReason)
}

function goToDestination(navigate: ReturnType<typeof useNavigate>, destination: GameDestination) {
  if (destination.kind === 'home') {
    void navigate({ to: '/', replace: true })
  } else if (destination.kind === 'lobby') {
    void navigate({
      to: '/rooms/$roomId/lobby',
      params: { roomId: destination.roomId },
      replace: true,
    })
  }
}

type GameDestination = { kind: 'stay' } | { kind: 'home' } | { kind: 'lobby'; roomId: string }

/** 화면이 머물 곳 — 게임(그대로) · 랜딩 · 대기실. 판정은 순수 함수라 그대로 시험할 수 있다. */
export function gameDestination(options: GameRoomGuardOptions): GameDestination {
  const { matchingRoom, roomSession, roomSnapshot, roomResumeReason } = options
  if (!roomSession || !roomSnapshot || !matchingRoom || roomResumeReason) return { kind: 'home' }
  if (roomSnapshot.phase === 'waiting') return { kind: 'lobby', roomId: roomSession.roomId }
  return { kind: 'stay' }
}

/** 화면 모듈을 모르는 게임 코드면 게임 하나를 조회해 스냅샷을 채운다. */
export function useFallbackGame(
  matchingRoom: boolean,
  screensKnown: boolean,
  gameId: string | null,
) {
  useGame(matchingRoom && !screensKnown ? gameId : null)
}

/** 게임 화면이 공유하는 상점 셀렉터 묶음 — 화면 본문을 짧게 유지한다. */
export function useGamePageState(roomId: string) {
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const matchingRoom = roomSession?.roomId === roomId
  return { matchingRoom, roomResumeReason, roomSession, roomSnapshot }
}
