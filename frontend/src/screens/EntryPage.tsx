import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { getRoomCodeError, normalizeRoomCode } from '@/roomCode'

export function EntryPage() {
  const navigate = useNavigate()
  const [roomCode, setRoomCode] = useState('')
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null)

  const handleCreate = () => {
    void navigate({ to: '/join', search: { code: undefined } })
  }

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = normalizeRoomCode(roomCode)
    const error = getRoomCodeError(code)
    setRoomCodeError(error)
    if (error) return

    void navigate({ to: '/join', search: { code } })
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <section className="grid w-full max-w-lg gap-5 text-center">
        <p className="m-0 text-xs font-bold tracking-[0.16em] text-brand-strong">
          REAL-TIME YACHT DICE
        </p>
        <h1 className="m-0 text-[clamp(4rem,24vw,8rem)] leading-[0.9] font-bold tracking-[-0.08em] text-brand">
          YORR
        </h1>
        <p className="m-0 text-content-muted">흔들거나 탭해서 함께 즐기는 모바일 요트다이스</p>
        <Button className="mt-3 w-full rounded-full" size="lg" onClick={handleCreate}>
          방 만들기
        </Button>
        <div className="flex items-center gap-3 text-sm text-content-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          또는
          <span className="h-px flex-1 bg-border" />
        </div>
        <form className="grid gap-3" onSubmit={handleJoin} noValidate>
          <TextField
            label="초대 코드"
            value={roomCode}
            placeholder="YORR64"
            autoCapitalize="characters"
            autoComplete="off"
            errorMessage={roomCodeError}
            onChange={(event) => {
              setRoomCode(event.target.value)
              setRoomCodeError(null)
            }}
          />
          <Button type="submit" variant="secondary" className="w-full">
            코드로 참가
          </Button>
        </form>
      </section>
    </main>
  )
}
