import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  generateNickname,
  NICKNAME_MAX_LENGTH,
  readSavedNickname,
  resolveNickname,
  saveNickname,
} from '@/auth/nickname'
import { type GameKey, gameByKey } from '@/games'
import { useCreateRoom, useJoinRoom } from '@/room/api/useRoomApi'
import { savePartyRoom } from '@/room/partyControllerStorage'
import { toUserError } from '@/shared/api/userError'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { Alert } from '@/shared/components/Alert'
import { Button } from '@/shared/components/Button'
import { IconBack } from '@/shared/components/Icon'
import { Screen } from '@/shared/components/Screen'
import { TextField } from '@/shared/components/TextField'
import { useAppStore } from '@/store'

interface NicknamePageProps {
  gameKey?: GameKey | undefined
  mode?: 'quick' | undefined
  party?: boolean | undefined
  roomCode?: string | undefined
}

const intents = {
  join: {
    chip: null,
    subtitle: '같은 방 친구들에게 이 이름이 보여요',
    cta: '대기실 입장',
    busy: '입장하는 중이에요',
  },
  quick: {
    chip: '온라인 대전',
    subtitle: '지금 기다리는 다른 사람과 바로 이어드려요',
    cta: '상대 찾기',
    busy: '상대를 찾고 있어요',
  },
  create: {
    chip: '온라인 프라이빗 룸',
    subtitle: '방을 만들면 초대 링크가 바로 생성돼요',
    cta: '대기실 입장',
    busy: '방을 만들고 있어요',
  },
} as const

export function NicknamePage({ gameKey, mode, party = false, roomCode }: NicknamePageProps) {
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
  const copy = intents[roomCode ? 'join' : quick ? 'quick' : 'create']
  const task = roomCode ? joinRoom : createRoom
  const selectedGame = gameByKey(gameKey)
  const userError = task.error ? toUserError(task.error) : null
  const signInRequired = quick && !authSession

  useEffect(() => playLandingSoundtrack(selectedGame.key), [selectedGame.key])

  useEffect(() => {
    if (userError?.clearsSession) useAppStore.getState().reset()
  }, [userError])

  const enterRoom = async (resolvedNickname: string) => {
    submittingRef.current = true
    try {
      const session = roomCode
        ? await joinRoom.execute(roomCode, { nickname: resolvedNickname })
        : await createRoom.execute({
            nickname: resolvedNickname,
            gameCode: selectedGame.gameCode ?? 'YACHT_DICE',
          })
      if (!session) return

      if (party) savePartyRoom(session.roomCode)
      saveNickname(resolvedNickname)
      await navigate({
        to: '/rooms/$roomId/lobby',
        params: { roomId: session.roomId },
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
      startQuickMatch({
        gameCode: selectedGame.gameCode ?? 'YACHT_DICE',
        nickname: resolved.nickname,
      })
      return
    }

    void enterRoom(resolved.nickname)
  }

  return (
    <Screen className="relative max-w-2xl overflow-hidden">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-32 -left-7 font-mono text-[11.875rem] leading-none font-bold tracking-[-0.04em] text-content/4 select-none"
      >
        {roomCode ?? 'YORR'}
      </span>

      <header className="relative flex items-center gap-3">
        <button
          aria-label="뒤로 가기"
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content transition-colors hover:bg-surface-raised focus-ring pressable"
          onClick={() => void navigate({ to: '/' })}
          type="button"
        >
          <IconBack className="size-4.5" />
        </button>
        <span className="inline-flex h-[2.125rem] items-center gap-2 rounded-full border border-border bg-surface-veil px-3.5 text-xs font-semibold">
          {roomCode ? (
            <>
              초대 코드{' '}
              <span className="font-mono font-bold tracking-[0.1em] text-content">{roomCode}</span>
            </>
          ) : (
            copy.chip
          )}
        </span>
      </header>

      <div className="relative mt-11 grid gap-2">
        <h1 className="m-0 text-2xl leading-[1.3] font-bold tracking-[-0.02em]">
          어떤 이름으로 참가할까요?
        </h1>
        <p className="m-0 text-sm text-content-muted">{copy.subtitle}</p>
      </div>

      <form
        className="relative mt-8 flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <TextField
          label={<span className="sr-only">닉네임</span>}
          value={nickname}
          placeholder={suggestion}
          helpText={
            <>
              비워두면 <span className="font-semibold text-content">{suggestion}</span>
              (으)로 입장해요 · 한글·영문·숫자 1~{NICKNAME_MAX_LENGTH}자
            </>
          }
          errorMessage={validationError}
          maxLength={NICKNAME_MAX_LENGTH + 1}
          autoComplete="nickname"
          disabled={task.isLoading}
          onChange={(event) => {
            setNickname(event.target.value)
            setValidationError(null)
          }}
        />
        <div className="mt-auto grid gap-3">
          {signInRequired && (
            <Alert tone="danger">
              빠른 대전은 로그인이 필요해요. 홈에서 로그인한 뒤 다시 시도해 주세요.
            </Alert>
          )}
          {!roomCode && !quick && (
            <Alert className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-5 flex-none place-items-center rounded-chip bg-border text-2xs leading-none font-bold text-content"
              >
                1
              </span>
              방을 만든 사람이 호스트가 돼요
            </Alert>
          )}
          {userError && (
            <Alert className="grid gap-2 text-left" tone="danger">
              {/* role은 Alert가 든다 — 여기 또 적으면 이중으로 읽힌다 */}
              <p className="m-0">{userError.message}</p>
              {userError.canChangeRoom && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigate({ to: '/' })}
                >
                  {roomCode ? '다른 코드 입력' : '홈으로'}
                </Button>
              )}
            </Alert>
          )}
          <Button
            className="w-full"
            disabled={signInRequired}
            loading={task.isLoading}
            size="cta"
            type="submit"
          >
            {task.isLoading ? copy.busy : copy.cta}
          </Button>
        </div>
      </form>
    </Screen>
  )
}
