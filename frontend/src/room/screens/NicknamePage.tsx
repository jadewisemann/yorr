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
import { toUserError } from '@/shared/api/userError'
import { playLandingSoundtrack } from '@/shared/audio/soundtrack'
import { Button } from '@/shared/components/Button'
import { TextField } from '@/shared/components/TextField'
import { useAppStore } from '@/store'

interface NicknamePageProps {
  gameKey?: GameKey | undefined
  roomCode?: string | undefined
}

export function NicknamePage({ gameKey, roomCode }: NicknamePageProps) {
  const navigate = useNavigate()
  const createRoom = useCreateRoom()
  const joinRoom = useJoinRoom()
  const authSession = useAppStore((state) => state.authSession)
  const [suggestion] = useState(generateNickname)
  // 로그인했다면 그 계정의 닉네임에서 시작한다 — 로그인해 놓고 이름을 다시 짓게 하면
  // 로그인한 값이 어디로 갔는지 알 수 없다. 그래도 이 판에서만 다르게 쓰고 싶을 수 있어
  // 고칠 수 있게 둔다(프로필 닉네임은 바뀌지 않는다).
  const [nickname, setNickname] = useState(() => authSession?.nickname ?? readSavedNickname() ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const task = roomCode ? joinRoom : createRoom
  const selectedGame = gameByKey(gameKey)
  const userError = task.error ? toUserError(task.error) : null

  useEffect(() => playLandingSoundtrack(selectedGame.key), [selectedGame.key])

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
    try {
      const session = roomCode
        ? await joinRoom.execute(roomCode, { nickname: resolved.nickname })
        : await createRoom.execute({
            nickname: resolved.nickname,
            gameCode: selectedGame.gameCode ?? 'YACHT_DICE',
          })
      if (!session) return

      saveNickname(resolved.nickname)
      await navigate({
        to: '/rooms/$roomId/lobby',
        params: { roomId: session.roomId },
      })
    } finally {
      submittingRef.current = false
    }
  }

  return (
    // 디자인 02 — 카드 없이 풀스크린. 좌상단 뒤로가기·코드 칩, 좌측 정렬 헤드라인,
    // 하단 고정 CTA. 배경엔 방 코드 워터마크가 아주 흐리게 깔린다.
    <main className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col overflow-hidden px-gutter pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-32 -left-7 font-mono text-[11.875rem] leading-none font-bold tracking-[-0.04em] text-white/4 select-none"
      >
        {roomCode ?? 'YORR'}
      </span>

      <header className="relative flex items-center gap-3">
        <button
          aria-label="뒤로 가기"
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-lg text-content transition-colors hover:bg-surface-raised focus-ring"
          onClick={() => void navigate({ to: '/' })}
          type="button"
        >
          ‹
        </button>
        <span className="inline-flex h-[2.125rem] items-center gap-2 rounded-full border border-border bg-white/6 px-3.5 text-[13px] font-semibold">
          {roomCode ? (
            <>
              초대 코드{' '}
              <span className="font-mono font-bold tracking-[0.1em] text-content">{roomCode}</span>
            </>
          ) : (
            '온라인 프라이빗 룸'
          )}
        </span>
      </header>

      <div className="relative mt-11 grid gap-2.5">
        <h1 className="m-0 text-[28px] leading-[1.3] font-bold tracking-[-0.02em]">
          어떤 이름으로 참가할까요?
        </h1>
        <p className="m-0 text-[15px] text-content-muted">
          {roomCode
            ? '같은 방 친구들에게 이 이름이 보여요'
            : '방을 만들면 초대 링크가 바로 생성돼요'}
        </p>
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
              {/* 실제 검증(nickname.ts getNicknameError)은 빈 값만 거부해 최소 1자를 허용한다 —
                  안내 문구도 여기 맞춘다(QA FND-1). */}
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
          {!roomCode && (
            <p className="m-0 flex items-center gap-2.5 rounded-card border border-border bg-surface px-3.5 py-3 text-sm text-content-muted">
              <span
                aria-hidden="true"
                className="grid size-5 flex-none place-items-center rounded-[6px] bg-white/10 text-[11px] leading-none font-bold text-content"
              >
                1
              </span>
              방을 만든 사람이 호스트가 돼요
            </p>
          )}
          {userError && (
            <div className="grid gap-2 rounded-card border border-brand/36 bg-brand/8 px-3.5 py-3 text-left">
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
          <Button type="submit" size="cta" loading={task.isLoading} className="w-full">
            {task.isLoading
              ? roomCode
                ? '입장하는 중이에요'
                : '방을 만들고 있어요'
              : '대기실 입장'}
          </Button>
        </div>
      </form>
    </main>
  )
}
