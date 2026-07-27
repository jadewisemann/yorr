import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { getRoomCodeError, normalizeRoomCode } from '@/roomCode'

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
    void navigate({ to: '/join', search: { code } })
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-5 rounded-panel border border-border bg-surface p-6 shadow-raised">
        <header className="grid gap-2 text-center">
          <h1 className="m-0 text-display font-bold text-content">초대 코드를 확인해 주세요</h1>
          <p className="m-0 text-content-muted">
            링크의 코드가 올바르지 않아 아직 입장 요청을 보내지 않았어요.
          </p>
        </header>
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <TextField
            label="초대 코드"
            value={roomCode}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            maxLength={12}
            errorMessage={error}
            onChange={(event) => {
              setRoomCode(event.target.value)
              setError(null)
            }}
          />
          <Button type="submit">수정한 코드로 참가</Button>
          <Button type="button" variant="ghost" onClick={() => void navigate({ to: '/' })}>
            홈으로
          </Button>
        </form>
      </section>
    </main>
  )
}
