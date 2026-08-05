import { useEffect, useMemo, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  type LiarsBid,
  type LiarsState,
  type RoomSnapshot,
} from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import type { ActiveRoomSession } from '@/store'
import {
  alivePlayers,
  bidError,
  countFace,
  LIARS_FACES,
  lowestLegalBid,
  totalDiceInPlay,
} from './domain/liarsBid'
import { LiarsDie } from './LiarsDie'

/**
 * 라이어스 다이스 — 숨긴 주사위로 겨루는 심리 게임.
 *
 * 이 화면이 절대 하지 않는 것: <b>남의 주사위를 알아내는 것</b>. 서버는 내 손패를
 * 나에게만(`game.liars.hand`) 보내고, 방 전체가 받는 상태(`game.liars.state`)에는 남은
 * 개수만 있다. 그래서 여기서 "가리는" 코드는 없다 — 애초에 가릴 값이 오지 않는다.
 * 남의 눈은 챌린지로 공개된 `lastReveal.hands`에만 있다.
 *
 * 판정도 하지 않는다. 선언·의심을 올리고, 서버가 내려준 상태를 그대로 그린다.
 * `domain/liarsBid`의 검사는 서버 규칙의 거울일 뿐이다(못 보낼 버튼을 열어두지 않기 위해).
 */

interface LiarsGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function LiarsGame({ onLeaveRequest, roomId, session, snapshot }: LiarsGameProps) {
  const client = useRealtimeClient()
  const view = snapshot.game as unknown as LiarsState | undefined
  const { hand, notice, setNotice } = usePrivateHand()
  const [draft, setDraft] = useState<Bid | null>(null)

  const standing = view?.bid ?? null
  const totalDice = view ? totalDiceInPlay(view.dice) : 0
  const myTurn = view?.phase === 'BIDDING' && view.turnId === session.you
  const lowest = useMemo(() => lowestLegalBid(standing, totalDice), [standing, totalDice])

  // 선언이 바뀌면 조작판을 그때 부를 수 있는 가장 낮은 선언으로 되돌린다 — 이전 라운드의
  // 값이 남아 있으면 이미 못 부르는 선언이 버튼에 걸려 있다.
  useEffect(() => {
    setDraft(lowest)
    setNotice(null)
  }, [lowest, setNotice])

  const bid = draft ?? lowest
  const invalid = bid ? bidError(standing, bid.quantity, bid.face, totalDice) : '더 높일 수 없어요'

  const send = (message: Parameters<typeof client.send>[0]) => {
    try {
      client.send(message)
      setNotice(null)
    } catch {
      setNotice('연결을 확인한 뒤 다시 시도해 주세요')
    }
  }

  const declare = () => {
    if (bid && !invalid) send(buildClientMessage('game.liars.bid', bid, { roomId }))
  }

  const challenge = () => {
    if (standing) send(buildClientMessage('game.liars.challenge', {}, { roomId }))
  }

  if (!view) {
    return (
      <main className="grid h-svh place-items-center bg-surface-sunken text-content">
        주사위를 나누고 있어요.
      </main>
    )
  }

  const nickname = (playerId: string) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '플레이어'
  const reveal = view.phase === 'REVEAL' ? view.lastReveal : null

  return (
    <main className="flex min-h-svh flex-col gap-5 bg-surface-sunken px-gutter pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-content">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="m-0 font-mono text-[11px] tracking-[0.18em] text-content-muted">
            ROUND {view.round} · 판에 {totalDice}개
          </p>
          <h1 className="m-0 text-xl font-bold">라이어스 다이스</h1>
        </div>
        <Button onClick={onLeaveRequest} size="sm" variant="secondary">
          나가기
        </Button>
      </header>

      <section aria-label="참가자" className="grid gap-2">
        {view.playerOrder.map((playerId) => (
          <PlayerRow
            count={view.dice[playerId] ?? 0}
            key={playerId}
            me={playerId === session.you}
            nickname={nickname(playerId)}
            turn={view.turnId === playerId}
          />
        ))}
      </section>

      <section
        aria-label="현재 선언"
        className="grid gap-2 rounded-card border border-border bg-surface px-4 py-3.5"
      >
        {standing ? (
          <>
            <p className="m-0 text-[12.5px] text-content-muted">
              {nickname(standing.playerId)}의 선언
            </p>
            <p className="m-0 flex items-center gap-2.5 text-lg font-bold">
              <LiarsDie size="sm" value={standing.face} />× {standing.quantity}개
            </p>
          </>
        ) : (
          <p className="m-0 text-[13.5px] text-content-muted">
            아직 선언이 없어요. {nickname(view.turnId ?? '')}이(가) 먼저 부릅니다.
          </p>
        )}
      </section>

      {reveal && <RevealPanel nickname={nickname} reveal={reveal} />}

      <MyHand eliminated={(view.dice[session.you] ?? 0) === 0} hand={hand} standing={standing} />

      <div className="mt-auto grid gap-3">
        <ActionBar
          bid={bid}
          challengeable={standing !== null}
          invalid={invalid}
          minQuantity={lowest?.quantity ?? 1}
          myTurn={myTurn}
          notice={notice}
          onBid={declare}
          onChallenge={challenge}
          onDraft={setDraft}
          totalDice={totalDice}
          waiting={
            view.phase === 'REVEAL'
              ? '다음 라운드를 준비하고 있어요'
              : `${nickname(view.turnId ?? '')}의 차례를 기다리고 있어요`
          }
        />
      </div>
    </main>
  )
}

/**
 * 내 손패를 받는 구독. 손패는 방 스냅샷이 아니라 개인 소켓으로만 오므로(그게 이 게임의
 * 보안 계약이다) 스토어를 거치지 않고 이 화면이 직접 받는다. 서버가 되돌린 조작 안내도
 * 같은 자리에서 받는다 — 왜 선언이 서지 않았는지 말해주지 않으면 사용자는 알 수 없다.
 */
function usePrivateHand() {
  const client = useRealtimeClient()
  const [hand, setHand] = useState<number[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    return client.onMessage((message) => {
      if (message.type === 'game.liars.hand') {
        setHand(message.payload.dice)
        setNotice(null)
      } else if (message.type === 'error' && message.payload.code === 'NOT_YOUR_TURN') {
        setNotice('지금은 당신의 차례가 아니에요')
      }
    })
  }, [client])

  return { hand, notice, setNotice }
}

/** 아래쪽 조작 영역. 내 차례가 아니면 기다리는 안내만 선다. */
function ActionBar({
  bid,
  challengeable,
  invalid,
  minQuantity,
  myTurn,
  notice,
  onBid,
  onChallenge,
  onDraft,
  totalDice,
  waiting,
}: {
  bid: Bid | null
  challengeable: boolean
  invalid: string | null
  minQuantity: number
  myTurn: boolean
  notice: string | null
  onBid: () => void
  onChallenge: () => void
  onDraft: (bid: Bid) => void
  totalDice: number
  waiting: string
}) {
  const message = notice ?? (myTurn ? invalid : null)
  return (
    <>
      {message && (
        <p className="m-0 text-center text-sm text-danger" role="alert">
          {message}
        </p>
      )}
      {myTurn ? (
        <>
          <BidControls
            bid={bid}
            minQuantity={minQuantity}
            onChange={onDraft}
            totalDice={totalDice}
          />
          <Button disabled={!bid || invalid !== null} onClick={onBid} size="cta">
            선언하기
          </Button>
          <Button disabled={!challengeable} onClick={onChallenge} size="lg" variant="secondary">
            의심하기
          </Button>
        </>
      ) : (
        <p className="m-0 text-center text-sm text-content-muted">{waiting}</p>
      )}
    </>
  )
}

function PlayerRow({
  count,
  me,
  nickname,
  turn,
}: {
  count: number
  me: boolean
  nickname: string
  turn: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-2.5',
        turn && 'border-brand/60 bg-brand/8',
        count === 0 && 'opacity-45',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {nickname}
        {me && ' (나)'}
      </span>
      {turn && (
        <span className="rounded-full border border-brand/40 px-2 py-0.5 text-[10.5px] font-bold tracking-[0.08em] text-brand">
          차례
        </span>
      )}
      <span className="font-mono text-sm text-content-muted">
        {count === 0 ? '탈락' : `주사위 ${count}`}
      </span>
    </div>
  )
}

/** 챌린지 판정. 여기 그려지는 남의 주사위는 서버가 공개한 값이다(그 전에는 오지 않는다). */
function RevealPanel({
  nickname,
  reveal,
}: {
  nickname: (playerId: string) => string
  reveal: NonNullable<LiarsState['lastReveal']>
}) {
  return (
    <section
      className="grid gap-3 rounded-card border border-brand/36 bg-brand/8 px-4 py-4"
      role="status"
    >
      <p className="m-0 text-sm font-bold">
        {reveal.bidTrue ? '선언은 사실이었어요' : '허풍이었어요'} —{' '}
        {`${reveal.bid.face}이(가) ${reveal.actual}개`}
      </p>
      <p className="m-0 text-[13px] text-content-muted">
        {nickname(reveal.loserId)}이(가) 주사위 1개를 잃었어요
        {reveal.eliminatedId ? ` · ${nickname(reveal.eliminatedId)} 탈락` : ''}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {Object.entries(reveal.hands).map(([playerId, dice]) => (
          <li className="flex items-center gap-2" key={playerId}>
            <span className="w-24 shrink-0 truncate text-[12.5px] text-content-muted">
              {nickname(playerId)}
            </span>
            <DiceRow dice={dice} dim mark={reveal.bid.face} size="sm" />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 내 주사위. 이 값은 개인 소켓으로만 온다 — 다른 사람의 화면에는 존재하지 않는다. */
function MyHand({
  eliminated,
  hand,
  standing,
}: {
  eliminated: boolean
  hand: readonly number[]
  standing: LiarsBid | null
}) {
  return (
    <section aria-label="내 주사위" className="grid gap-2">
      <p className="m-0 text-[11px] font-semibold tracking-[0.14em] text-content-muted">
        내 주사위 · 나만 보여요
      </p>
      {hand.length === 0 ? (
        <p className="m-0 text-[13.5px] text-content-muted">
          {eliminated ? '탈락했어요. 남은 판을 지켜봐 주세요.' : '주사위를 기다리고 있어요.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <DiceRow dice={hand} mark={standing?.face} />
          {standing && (
            <span className="ml-1 text-[12.5px] text-content-muted">
              내 {standing.face} {countFace(hand, standing.face)}개
            </span>
          )}
        </div>
      )}
    </section>
  )
}

type Bid = { quantity: number; face: number }

/**
 * 선언 조작판. 수량과 눈을 고를 뿐이고 무엇이 유효한지는 모른다 —
 * 보낼 수 있는지 판단은 `bidError`(서버 규칙의 거울) 하나에만 둔다.
 */
function BidControls({
  bid,
  minQuantity,
  onChange,
  totalDice,
}: {
  bid: Bid | null
  minQuantity: number
  onChange: (bid: Bid) => void
  totalDice: number
}) {
  if (!bid) return null
  return (
    <div className="grid gap-2.5 rounded-card border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-content-muted">수량</span>
        <div className="flex items-center gap-2">
          <Button
            aria-label="수량 줄이기"
            disabled={bid.quantity <= minQuantity}
            onClick={() => onChange({ ...bid, quantity: bid.quantity - 1 })}
            size="sm"
            variant="secondary"
          >
            −
          </Button>
          <span className="w-8 text-center font-mono text-lg font-bold">{bid.quantity}</span>
          <Button
            aria-label="수량 늘리기"
            disabled={bid.quantity >= totalDice}
            onClick={() => onChange({ ...bid, quantity: bid.quantity + 1 })}
            size="sm"
            variant="secondary"
          >
            +
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-content-muted">눈</span>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: LIARS_FACES }, (_, index) => index + 1).map((face) => (
            <button
              aria-label={`주사위 ${face} 선택`}
              aria-pressed={bid.face === face}
              className={cn(
                'cursor-pointer rounded-[0.5rem] border border-border bg-transparent p-1 transition-colors focus-ring',
                bid.face === face && 'border-brand bg-brand/12',
              )}
              key={face}
              onClick={() => onChange({ ...bid, face })}
              type="button"
            >
              <LiarsDie size="sm" value={face} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 주사위 한 줄. `mark`와 같은 눈은 강조한다 — 지금 세고 있는 눈이 무엇인지 보이게 한다. */
function DiceRow({
  dice,
  dim = false,
  mark,
  size = 'md',
}: {
  dice: readonly number[]
  dim?: boolean
  mark?: number | undefined
  size?: 'sm' | 'md'
}) {
  return dice.map((value, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 주사위는 자리가 곧 정체성이다
    <LiarsDie dim={dim} key={index} marked={value === mark} size={size} value={value} />
  ))
}

export function LiarsResult({ onLeaveRequest, session, snapshot }: Omit<LiarsGameProps, 'roomId'>) {
  const returnToLobby = useReturnToLobby()
  const view = snapshot.game as unknown as LiarsState | undefined
  const host = isRoomHost(snapshot, session.you)
  const winnerId = view?.winnerId ?? (view ? alivePlayers(view)[0] : undefined)
  const nickname = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '플레이어'

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-surface-sunken px-gutter text-content">
      <p className="m-0 font-mono text-xs tracking-[0.22em] text-content-muted">GAME FINISHED</p>
      <h1 className="m-0 text-4xl font-black">
        {winnerId === session.you ? '마지막까지 지켰어요!' : `${nickname(winnerId)} 승리`}
      </h1>
      <ul className="m-0 grid w-full max-w-sm list-none gap-2 p-0">
        {(view?.playerOrder ?? snapshot.players.map((player) => player.playerId)).map(
          (playerId) => (
            <li
              className="flex items-center justify-between rounded-card border border-border bg-surface px-3.5 py-2.5 text-sm"
              key={playerId}
            >
              <span className="min-w-0 truncate font-semibold">{nickname(playerId)}</span>
              <span className="font-mono text-content-muted">
                주사위 {view?.dice[playerId] ?? 0}
              </span>
            </li>
          ),
        )}
      </ul>
      <div className="grid w-full max-w-sm gap-3">
        {host ? (
          <Button
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
            size="lg"
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-sm text-content-muted">
            호스트가 다음 판을 준비하고 있어요.
          </p>
        )}
        <Button onClick={onLeaveRequest} size="lg" variant="secondary">
          나가기
        </Button>
      </div>
    </main>
  )
}
