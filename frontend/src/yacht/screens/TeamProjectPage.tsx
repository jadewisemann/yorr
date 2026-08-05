import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import {
  generateNickname,
  NICKNAME_MAX_LENGTH,
  readSavedNickname,
  resolveNickname,
  saveNickname,
} from '@/auth/nickname'
import type { GameCode } from '@/games'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type ServerMessage } from '@/realtime/wsEvents'
import { useStartGame } from '@/room/api/useGameApi'
import { useCreateRoom, useJoinRoom, useLeaveSession } from '@/room/api/useRoomApi'
import { toUserError } from '@/shared/api/userError'
import { Button } from '@/shared/components/Button'
import { TextField } from '@/shared/components/TextField'
import { useAppStore } from '@/store'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { TEAM_YACHT_SEATS, type TeamYachtView } from '@/yacht/domain/teamProject'
import { TeamProjectBoard } from './TeamProjectBoard'

/**
 * 조별과제 야트(S15P11A406-209) — 온라인 3인 한 팀.
 *
 * 랜딩에 진입점을 두지 않는다(카탈로그 `games.ts`에 항목을 추가하지 않는다). 그래서 방을 여는
 * 최소 경로를 이 라우트 안에 들고 있다: 이름을 받아 방을 만들고(초대 코드 공유), 코드로 들어온
 * 사람은 같은 라우트에 `?code=`로 붙는다. `/rooms/:id/lobby` · `GamePage`를 경유하지 않는
 * 이유도 같다 — 그 화면들은 카탈로그의 `GameCode`로 게임을 고르므로, 카탈로그에 없는 모드는
 * 그 길로 자기 화면에 도달할 수 없다.
 *
 * 소켓은 앱이 이미 들고 있다. 방 세션(store.roomSession)을 채우면 `app/RealtimeSync`가
 * 연결하고 `room.join`까지 보낸다 — 여기서 따로 연결하지 않는다.
 */
export function TeamProjectPage({ code }: { code?: string | undefined }) {
  const roomSession = useAppStore((state) => state.roomSession)

  return roomSession ? <TeamProjectRoom code={code} /> : <TeamProjectEntry code={code} />
}

/** 이름을 받아 방을 만들거나 초대 코드로 들어간다. 성공하면 세션이 생겨 아래 방 화면으로 넘어간다. */
function TeamProjectEntry({ code }: { code?: string | undefined }) {
  const navigate = useNavigate()
  const createRoom = useCreateRoom()
  const joinRoom = useJoinRoom()
  const authSession = useAppStore((state) => state.authSession)
  const [suggestion] = useState(generateNickname)
  const [nickname, setNickname] = useState(() => authSession?.nickname ?? readSavedNickname() ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const task = code ? joinRoom : createRoom
  const userError = task.error ? toUserError(task.error) : null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const resolved = resolveNickname(nickname, suggestion)
    setValidationError(resolved.error)
    if (resolved.error) return

    void (async () => {
      const session = code
        ? await joinRoom.execute(code, { nickname: resolved.nickname })
        : // TEAM_YACHT은 랜딩 카탈로그에 없는 모드라 GameCode 유니온 밖이다. 카탈로그는 다른
          // 티켓이 쓰고 있어 유니온을 넓히지 않고 이 경계에서만 통과시킨다 — 서버는
          // GameModuleRegistry로 코드를 검증하므로 오타는 방 생성 단계에서 걸린다.
          await createRoom.execute({
            nickname: resolved.nickname,
            gameCode: 'TEAM_YACHT' as GameCode,
          })
      if (session) saveNickname(resolved.nickname)
    })()
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-gutter text-content">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          조별과제 야트 · 3인 1팀
        </p>
        <h1 className="m-0 text-2xl font-bold">
          {code ? `${code} 방에 들어가기` : '점수판 하나를 셋이 씁니다'}
        </h1>
        <p className="m-0 text-sm text-content-muted">
          한 라운드에 세 사람이 한 번씩 굴리고, 기록할 족보는 다수결로 정해요.
        </p>
      </header>

      <form className="grid gap-4" onSubmit={submit}>
        <TextField
          autoComplete="nickname"
          errorMessage={validationError ?? userError?.message}
          label="이름"
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(event) => setNickname(event.target.value)}
          placeholder={suggestion}
          value={nickname}
        />
        <Button loading={task.isLoading} size="cta" type="submit">
          {code ? '대기실 입장' : '방 만들기'}
        </Button>
        <Button onClick={() => void navigate({ to: '/' })} type="button" variant="ghost">
          나가기
        </Button>
      </form>
    </main>
  )
}

/**
 * 방에 들어간 뒤. 게임이 시작되기 전에는 초대 코드와 명단을, 시작한 뒤에는 판을 그린다.
 *
 * 진행 상태를 전역 스토어에서 읽지 않는다 — `game.team_yacht.state`는 <b>사람마다 다른</b>
 * 개인 메시지라 방 스냅샷(모두가 같은 값을 보는 자리)에 담을 수 없다. 그래서 이 화면이
 * 자기 수명만큼 사는 사본을 직접 듣는다.
 */
function TeamProjectRoom({ code }: { code?: string | undefined }) {
  const navigate = useNavigate()
  const client = useRealtimeClient()
  const startGame = useStartGame()
  const { isLeaving, leave } = useLeaveSession()
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)
  const resumeRoomSession = useAppStore((state) => state.resumeRoomSession)
  const [view, setView] = useState<TeamYachtView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 새로고침으로 돌아온 세션은 '이어서 하기' 대기 상태다. 그대로 두면 소켓이 붙지 않아
  // 화면이 영원히 멈춘다 — 이 라우트로 직접 들어온 것 자체가 이어서 하겠다는 뜻이다.
  useEffect(() => {
    if (roomResumeReason === 'restored') resumeRoomSession()
  }, [resumeRoomSession, roomResumeReason])

  useEffect(
    () =>
      client.onMessage((message) => {
        const received = teamYachtView(message)
        if (received) {
          setView(received)
          setBusy(false)
          setNotice(null)
          return
        }
        if (message.type === 'error') {
          setBusy(false)
          setNotice(message.payload.message)
        }
      }),
    [client],
  )

  if (!roomSession) return null

  const send = (message: Parameters<typeof client.send>[0]) => {
    setBusy(true)
    try {
      client.send(message)
    } catch {
      setBusy(false)
      setNotice('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요')
    }
  }

  const roomId = roomSession.roomId
  const players = roomSnapshot?.players ?? []
  const inviteCode = code ?? roomSession.roomCode
  const startError = startGame.error ? toUserError(startGame.error).message : null

  if (view && view.stage !== 'FINISHED') {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md content-start gap-4 px-gutter py-4 text-content">
        <TeamProjectBoard
          busy={busy}
          onKeep={(picks) =>
            send(buildClientMessage('game.team_yacht.keep', { keep: picks }, { roomId }))
          }
          onRoll={() => send(buildClientMessage('game.team_yacht.roll', {}, { roomId }))}
          onVote={(category: YachtCategory) =>
            send(buildClientMessage('game.team_yacht.vote', { category }, { roomId }))
          }
          players={players}
          view={view}
          you={roomSession.you}
        />
        {notice ? <p className="m-0 text-center text-sm text-danger">{notice}</p> : null}
        <Button loading={isLeaving} onClick={() => void leave()} variant="ghost">
          나가기
        </Button>
      </main>
    )
  }

  if (view?.stage === 'FINISHED') {
    return (
      <main className="mx-auto grid h-svh w-full max-w-md content-center justify-items-center gap-6 px-gutter text-content">
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          조별과제 · {view.rounds}라운드 종료
        </p>
        <strong className="font-mono text-[64px] leading-none font-bold tabular-nums">
          {view.board.total}
        </strong>
        <p className="m-0 text-sm text-content-muted">셋이 함께 만든 점수예요.</p>
        <Button
          className="w-full"
          loading={isLeaving}
          onClick={() => void leave().then(() => navigate({ to: '/' }))}
          size="cta"
        >
          나가기
        </Button>
      </main>
    )
  }

  const missing = TEAM_YACHT_SEATS - players.length

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-gutter text-content">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          조별과제 야트 · 대기실
        </p>
        <h1 className="m-0 text-2xl font-bold">
          {missing > 0 ? `${missing}명 더 필요해요` : '셋이 모였어요'}
        </h1>
        <p className="m-0 text-sm text-content-muted">
          아래 주소를 팀원에게 보내세요 — 정원은 정확히 3명이에요.
        </p>
      </header>

      <div className="grid gap-2 rounded-panel border border-border bg-surface p-4">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] text-content-muted uppercase">
          초대 코드
        </span>
        <strong className="font-mono text-3xl font-bold tracking-[0.1em]">{inviteCode}</strong>
        <code className="overflow-x-auto text-[12px] text-content-muted">
          {inviteUrl(inviteCode)}
        </code>
      </div>

      <ol className="m-0 grid list-none gap-1.5 p-0">
        {players.map((player) => (
          <li
            className="flex items-center justify-between rounded-card border border-border bg-surface px-3 py-2 text-sm"
            key={player.playerId}
          >
            <span className="truncate font-bold">{player.nickname}</span>
            {player.playerId === roomSnapshot?.hostId ? (
              <span className="font-mono text-[10px] tracking-[0.12em] text-content-muted uppercase">
                host
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {startError ? <p className="m-0 text-sm text-danger">{startError}</p> : null}

      {roomSnapshot?.hostId === roomSession.you ? (
        <Button
          disabled={players.length !== TEAM_YACHT_SEATS}
          loading={startGame.isLoading}
          onClick={() => void startGame.execute()}
          size="cta"
        >
          시작하기
        </Button>
      ) : (
        <p className="m-0 text-center text-sm text-content-muted">방장이 시작하면 바로 시작돼요</p>
      )}
      <Button loading={isLeaving} onClick={() => void leave()} variant="ghost">
        나가기
      </Button>
    </main>
  )
}

/**
 * 내 개인 시야가 실린 메시지만 골라낸다. 진행 중 재접속은 `sys.reconnected`의 스냅샷에
 * 같은 값이 담겨 오므로(그 응답은 나에게만 간다) 두 경로를 함께 본다.
 */
function teamYachtView(message: ServerMessage): TeamYachtView | null {
  if (message.type === 'game.team_yacht.state') return message.payload
  if (message.type !== 'sys.reconnected' && message.type !== 'room.joined') return null
  const game = message.payload.snapshot.game
  // 방 스냅샷의 game은 아직 일반 야추 타입이 SSOT다. 게임별 계약이 갈리기 전까지 이 경계에서만 바꿔 읽는다.
  return game && 'stage' in game ? (game as unknown as TeamYachtView) : null
}

function inviteUrl(code: string) {
  if (typeof window === 'undefined') return `/team-yacht?code=${code}`
  return `${window.location.origin}/team-yacht?code=${code}`
}
