import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { getRoomCodeError, normalizeRoomCode } from '@/room/roomCode'
import { Button } from '@/shared/components/Button'
import { TextField } from '@/shared/components/TextField'

interface InvalidInvitePageProps {
  initialCode: string
}

export function InvalidInvitePage({ initialCode }: InvalidInvitePageProps) {
  const navigate = useNavigate()
  const [roomCode, setRoomCode] = useState(initialCode)
  const [error, setError] = useState(() => getRoomCodeError(initialCode))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = normalizeRoomCode(roomCode)
    const nextError = getRoomCodeError(code)
    setError(nextError)
    if (nextError) return
    void navigate({ to: '/join', search: { code, game: undefined } })
  }

  return (
    // 디자인 13 — 카드 없이 풀스크린. 좌상단 뒤로가기, 레드 경고 아이콘, 좌측 정렬 헤드라인.
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-gutter pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <header>
        <button
          aria-label="뒤로 가기"
          className="grid size-11 cursor-pointer place-items-center rounded-card border border-border bg-surface text-lg text-content transition-colors hover:bg-surface-raised focus-visible:outline-3 focus-visible:outline-focus"
          onClick={() => void navigate({ to: '/' })}
          type="button"
        >
          ‹
        </button>
      </header>

      <div className="mt-12 grid gap-4">
        <span
          aria-hidden="true"
          className="grid size-13 place-items-center rounded-panel border border-brand/42 bg-brand/12 text-2xl font-bold text-danger"
        >
          !
        </span>
        <h1 className="m-0 text-[27px] leading-[1.3] font-bold tracking-[-0.02em]">
          초대 코드를 확인해 주세요
        </h1>
        <p className="m-0 text-[15px] leading-[1.55] text-content-muted">
          링크의 코드가 올바르지 않아 아직 입장 요청을 보내지 않았어요.
        </p>
      </div>

      <form className="mt-7 flex min-h-0 flex-1 flex-col gap-3" onSubmit={submit} noValidate>
        <TextField
          label={
            <>
              <span className="sr-only">초대 코드</span>
              <span
                aria-hidden="true"
                className="font-mono text-[12px] font-bold tracking-[0.14em] text-content-muted uppercase"
              >
                Invite Code
              </span>
            </>
          }
          value={roomCode}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          maxLength={12}
          errorMessage={error}
          // 실제 검증(roomCode.ts getRoomCodeError)은 4~12자를 허용한다 — 힌트도 여기 맞춘다(QA FND-2).
          helpText="코드는 영문과 숫자 4~12자예요 · 소문자로 입력해도 대문자로 바뀌어요"
          className="font-mono text-2xl font-bold tracking-[0.18em]"
          onChange={(event) => {
            setRoomCode(event.target.value)
            setError(null)
          }}
        />
        <div className="mt-auto grid gap-3">
          <Button className="min-h-[3.625rem] rounded-panel text-lg" type="submit">
            수정한 코드로 참가
          </Button>
          <Button type="button" variant="ghost" onClick={() => void navigate({ to: '/' })}>
            홈으로
          </Button>
        </div>
      </form>
    </main>
  )
}
