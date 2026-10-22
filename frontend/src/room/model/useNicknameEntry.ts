import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { generateNickname, readSavedNickname, resolveNickname, saveNickname } from '@/auth/nickname'
import type { GameCode, GameKey } from '@/games'
import { gameByKey } from '@/games'
import { useCreateRoom, useJoinRoom } from '@/room/api/useRoomApi'
import { savePartyRoom } from '@/room/partyControllerStorage'
import { toUserError } from '@/shared/api/userError'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { useAppStore } from '@/store'

interface NicknameEntryOptions {
  gameKey: GameKey | undefined
  mode: 'quick' | undefined
  party: boolean
  roomCode: string | undefined
}

/**
 * 닉네임 화면의 상태와 제출. 세 의도(초대 입장·빠른 대전·방 만들기)가 같은 폼을
 * 공유하므로, 분기 기준(roomCode·quick)과 제출 경로를 한 곳에서 정한다.
 */
export function useNicknameEntry({ gameKey, mode, party, roomCode }: NicknameEntryOptions) {
  const navigate = useNavigate()
  const createRoom = useCreateRoom()
  const joinRoom = useJoinRoom()
  const startQuickMatch = useAppStore((state) => state.startQuickMatch)
  const waitingForMatch = useAppStore((state) => state.quickMatch !== null)
  const authSession = useAppStore((state) => state.authSession)
  const [suggestion] = useState(generateNickname)
  const [nickname, setNickname] = useState(() => authSession?.nickname ?? readSavedNickname() ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const quick = mode === 'quick'
  const task = roomCode ? joinRoom : createRoom
  const selectedGame = gameByKey(gameKey)
  const userError = task.error ? toUserError(task.error) : null
  const signInRequired = quick && !authSession
  const gameCode = selectedGame.gameCode ?? 'YACHT_DICE'

  useEffect(() => playLandingSoundtrack(selectedGame.key), [selectedGame.key])

  useEffect(() => {
    if (userError?.clearsSession) useAppStore.getState().reset()
  }, [userError])

  const enterRoom = async (resolvedNickname: string) => {
    submittingRef.current = true
    try {
      await openRoom({
        createRoom,
        gameCode,
        joinRoom,
        navigate,
        nickname: resolvedNickname,
        party,
        roomCode,
      })
    } finally {
      submittingRef.current = false
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current || signInRequired || waitingForMatch) return
    const resolved = resolveNickname(nickname, suggestion)
    setValidationError(resolved.error)
    if (resolved.error) return
    if (quick) {
      saveNickname(resolved.nickname)
      startQuickMatch({ gameCode, nickname: resolved.nickname })
      return
    }
    void enterRoom(resolved.nickname)
  }

  const handleNicknameChange = (value: string) => {
    setNickname(value)
    setValidationError(null)
  }

  return {
    goHome: () => void navigate({ to: '/' }),
    handleNicknameChange,
    handleSubmit,
    nickname,
    quick,
    signInRequired,
    suggestion,
    task,
    userError,
    validationError,
  }
}

interface OpenRoomOptions {
  createRoom: ReturnType<typeof useCreateRoom>
  gameCode: GameCode
  joinRoom: ReturnType<typeof useJoinRoom>
  navigate: ReturnType<typeof useNavigate>
  nickname: string
  party: boolean
  roomCode: string | undefined
}

/** 방을 열거나 참가하고 대기실로 이동한다. 세션을 못 받으면 아무 것도 바꾸지 않는다. */
async function openRoom(options: OpenRoomOptions) {
  const { createRoom, gameCode, joinRoom, navigate, nickname, party, roomCode } = options
  const session = roomCode
    ? await joinRoom.execute(roomCode, { nickname })
    : await createRoom.execute({ gameCode, nickname })
  if (!session) return
  if (party) savePartyRoom(session.roomCode)
  saveNickname(nickname)
  await navigate({ to: '/rooms/$roomId/lobby', params: { roomId: session.roomId } })
}
