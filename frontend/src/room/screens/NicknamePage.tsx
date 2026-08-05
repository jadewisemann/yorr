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
import { Button } from '@/shared/components/Button'
import { IconBack } from '@/shared/components/Icon'
import { TextField } from '@/shared/components/TextField'
import { useAppStore } from '@/store'

interface NicknamePageProps {
  gameKey?: GameKey | undefined
  /** 빠른 대전으로 들어왔는지(`/join?...&mode=quick`). 방을 만들지 않고 대기열에 선다. */
  mode?: 'quick' | undefined
  /** 파티 모드 QR로 들어왔는지(`/join?...&party=1`). 입장에 성공하면 그 방을 기억한다. */
  party?: boolean | undefined
  roomCode?: string | undefined
}

/**
 * 이 화면에 온 이유 셋. 갈리는 문구가 네 군데(칩·부제·CTA·진행 중)라 조건을 화면 곳곳에
 * 흩어두지 않고 한곳에 모은다. `join`의 칩만 방 코드를 품어 화면에서 직접 그린다.
 */
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
  // 이미 대기 중이면 다시 제출하지 않는다 — 백드롭이 이 화면을 덮고 있어도 Enter는 들어온다.
  const waitingForMatch = useAppStore((state) => state.quickMatch !== null)
  const authSession = useAppStore((state) => state.authSession)
  const [suggestion] = useState(generateNickname)
  // 로그인했다면 그 계정의 닉네임에서 시작한다 — 로그인해 놓고 이름을 다시 짓게 하면
  // 로그인한 값이 어디로 갔는지 알 수 없다. 그래도 이 판에서만 다르게 쓰고 싶을 수 있어
  // 고칠 수 있게 둔다(프로필 닉네임은 바뀌지 않는다).
  const [nickname, setNickname] = useState(() => authSession?.nickname ?? readSavedNickname() ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const quick = mode === 'quick'
  const copy = intents[roomCode ? 'join' : quick ? 'quick' : 'create']
  const task = roomCode ? joinRoom : createRoom
  const selectedGame = gameByKey(gameKey)
  const userError = task.error ? toUserError(task.error) : null
  // 빠른 대전은 대기열에 설 회원 세션이 있어야 한다. 게스트 토큰은 방에 들어갈 때만 발급되므로
  // 지금은 로그인한 사람만 설 수 있다(랜딩 모달에서도 같은 이유로 로그인으로 보낸다).
  const signInRequired = quick && !authSession

  useEffect(() => playLandingSoundtrack(selectedGame.key), [selectedGame.key])

  useEffect(() => {
    if (userError?.clearsSession) useAppStore.getState().reset()
  }, [userError])

  /** 방을 만들거나 초대 코드로 들어간다. 성공하면 그 방의 대기실로 옮긴다. */
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

      // 컨트롤러 여부는 입장에 성공한 뒤에 적는다 — 실패한 코드까지 기억하면 다음 방이
      // 엉뚱하게 컨트롤러로 뜬다.
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

    // 빠른 대전은 여기서 방을 만들지 않는다 — 대기열에 서고, 백드롭(QuickMatchOverlay)이
    // 매칭·이동을 맡는다. 이 화면은 그 뒤에 백드롭에 덮인 채로 남는다.
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
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content transition-colors hover:bg-surface-raised focus-ring"
          onClick={() => void navigate({ to: '/' })}
          type="button"
        >
          <IconBack className="size-4.5" />
        </button>
        <span className="inline-flex h-[2.125rem] items-center gap-2 rounded-full border border-border bg-white/6 px-3.5 text-xs font-semibold">
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

      <div className="relative mt-11 grid gap-2.5">
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
          {signInRequired && (
            <p
              className="m-0 rounded-card border border-brand/36 bg-brand/8 px-3.5 py-3 text-sm text-danger"
              role="alert"
            >
              빠른 대전은 로그인이 필요해요. 홈에서 로그인한 뒤 다시 시도해 주세요.
            </p>
          )}
          {!roomCode && !quick && (
            <p className="m-0 flex items-center gap-2.5 rounded-card border border-border bg-surface px-3.5 py-3 text-sm text-content-muted">
              <span
                aria-hidden="true"
                className="grid size-5 flex-none place-items-center rounded-chip bg-white/10 text-2xs leading-none font-bold text-content"
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
    </main>
  )
}
