import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { gameByCode } from '@/games'
import { useVoice } from '@/realtime/voice/VoiceContext'
import { isRoomHost } from '@/room/api/roomApi'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'
import { isDuoGame } from '@/room/domain/lobbyLabels'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { readSoundMuted, saveSoundMuted } from '@/shared/audio/soundPreference'
import { playLandingSoundtrack, setSoundtrackMuted } from '@/shared/audio/soundtrack'
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

export function useLobbyPage(roomId: string) {
  const navigate = useNavigate()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const startGame = useStartGame()
  const addBot = useAddBot()
  const removeBot = useRemoveBot()
  // 통화 자체는 라우터 위 VoiceProvider가 들고 있다 — 여기서는 상태만 읽는다.
  const voice = useVoice()
  const [audioOpen, setAudioOpen] = useState(false)
  const audioButtonRef = useRef<HTMLButtonElement>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const [exitRequested, setExitRequested] = useState(false)

  const matchingRoom = roomSession?.roomId === roomId
  const isHost = matchingRoom && isRoomHost(roomSnapshot, roomSession.you)
  const capacity = roomSnapshot?.capacity ?? 6
  const duoGame =
    isDuoGame(roomSnapshot?.gameCode) || (matchingRoom && isDuoGame(roomSession?.gameCode))
  const minPlayersToStart = duoGame ? 2 : 1
  const botMutationLoading = addBot.isLoading || removeBot.isLoading
  // 파티 모드 QR로 들어온 폰. 초대 패널을 세울 자리에 연결 안내가 대신 선다 —
  // QR·링크는 큰 화면이 이미 띄우고 있어서 여기 또 있으면 자기 폰을 자기가 찍게 된다.
  const controller = matchingRoom && isPartyRoom(roomSession.roomCode)
  const canStart =
    isHost &&
    connectionStatus === 'connected' &&
    roomSnapshot?.phase === 'waiting' &&
    roomSnapshot.players.length >= minPlayersToStart

  useEffect(() => {
    if (roomSnapshot?.phase === 'waiting') {
      playLandingSoundtrack(gameByCode(roomSnapshot.gameCode).key)
    }
    if (!roomSession || !matchingRoom || roomResumeReason) {
      void navigate({ to: '/', replace: true })
      return
    }
    if (roomSnapshot && roomSnapshot.phase !== 'waiting') {
      void navigate({
        to: '/rooms/$roomId/game',
        params: { roomId: roomSession.roomId },
        replace: true,
      })
    }
  }, [matchingRoom, navigate, roomResumeReason, roomSession, roomSnapshot])

  useEffect(() => {
    if (!matchingRoom || roomSnapshot?.phase !== 'waiting' || duoGame) return
    return schedulePhysicsDicePrefetch()
  }, [duoGame, matchingRoom, roomSnapshot?.phase])

  const handleStart = async () => {
    if (!roomSession || !canStart) return
    await startGame.execute()
  }

  const handleAddBot = async () => {
    if (!isHost || !roomSnapshot || roomSnapshot.players.length >= capacity) return
    await addBot.execute()
  }

  const handleToggleMute = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    setSoundtrackMuted(muted)
  }

  return {
    audioButtonRef,
    audioOpen,
    botAdding: addBot.isLoading,
    botError: addBot.error ?? removeBot.error,
    botLoading: botMutationLoading,
    canStart,
    capacity,
    connectionStatus,
    controller,
    duoGame,
    gameCode: roomSnapshot?.gameCode ?? roomSession?.gameCode ?? 'YACHT_DICE',
    exitRequested,
    handleAddBot,
    handleRemoveBot: (playerId: string) => void removeBot.execute(playerId),
    handleStart,
    handleToggleMute,
    inviteButtonRef,
    inviteOpen,
    isHost,
    minPlayersToStart,
    // 방이 어긋났거나 재개 사유가 있으면 위 effect가 화면을 옮긴다 — 그때까지 그릴 것이 없다.
    session: matchingRoom && !roomResumeReason ? roomSession : null,
    setAudioOpen,
    setExitRequested,
    setInviteOpen,
    snapshot: roomSnapshot,
    soundMuted,
    startError: startGame.error,
    startLoading: startGame.isLoading,
    voice,
  }
}
