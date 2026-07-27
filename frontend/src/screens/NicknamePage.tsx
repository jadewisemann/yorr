import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useCreateRoom, useJoinRoom } from '@/api/useRoomApi'
import { toUserError } from '@/api/userError'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import {
  generateNickname,
  NICKNAME_MAX_LENGTH,
  readSavedNickname,
  resolveNickname,
  saveNickname,
} from '@/nickname'
import { useAppStore } from '@/store'

interface NicknamePageProps {
  roomCode?: string | undefined
}

export function NicknamePage({ roomCode }: NicknamePageProps) {
  const navigate = useNavigate()
  const createRoom = useCreateRoom()
  const joinRoom = useJoinRoom()
  const [suggestion] = useState(generateNickname)
  const [nickname, setNickname] = useState(() => readSavedNickname() ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const task = roomCode ? joinRoom : createRoom
  const userError = task.error ? toUserError(task.error) : null

  useEffect(() => {
    if (userError?.clearsSession) useAppStore.getState().reset()
  }, [userError])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    const resolved = resolveNickname(nickname, suggestion)
    setValidationError(resolved.error)
    if (resolved.error) return

    submittingRef.current = true
    const session = roomCode
      ? await joinRoom.execute(roomCode, { nickname: resolved.nickname })
      : await createRoom.execute({
          mode: 'online',
          gameType: 'yacht',
          nickname: resolved.nickname,
        })
    submittingRef.current = false
    if (!session) return

    saveNickname(resolved.nickname)
    await navigate({
      to: '/rooms/$roomId/lobby',
      params: { roomId: session.roomId },
    })
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-6 rounded-panel border border-border bg-surface p-6 shadow-raised">
        <header className="grid gap-2 text-center">
          <p className="m-0 text-sm font-bold text-brand-strong">
            {roomCode ? `초대 코드 ${roomCode}` : '온라인 프라이빗 룸'}
          </p>
          <h1 className="m-0 text-display font-bold text-content">어떤 이름으로 참가할까요?</h1>
        </header>
        <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
          <TextField
            label="닉네임"
            value={nickname}
            placeholder={suggestion}
            helpText={`비워두면 ${suggestion}(으)로 입장해요.`}
            errorMessage={validationError}
            maxLength={NICKNAME_MAX_LENGTH + 1}
            autoComplete="nickname"
            disabled={task.isLoading}
            onChange={(event) => {
              setNickname(event.target.value)
              setValidationError(null)
            }}
          />
          <Button type="submit" size="lg" loading={task.isLoading} className="w-full">
            대기실 입장
          </Button>
          {userError && (
            <div className="grid gap-2 text-center">
              <p className="m-0 text-sm text-danger" role="alert">
                {userError.message}
              </p>
              {userError.canChangeRoom && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigate({ to: '/' })}
                >
                  {roomCode ? '다른 코드 입력' : '홈으로'}
                </Button>
              )}
            </div>
          )}
        </form>
      </section>
    </main>
  )
}
