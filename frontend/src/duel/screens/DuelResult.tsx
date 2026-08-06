import { Ammo } from '@/duel/components/Ammo'
import { Gunslinger } from '@/duel/components/Gunslinger'
import { ResultBackdrop } from '@/duel/components/ResultBackdrop'
import { type DuelOutcome, duelOutcome } from '@/duel/domain/duel'
import { OUTFIT_LEFT, OUTFIT_RIGHT } from '@/duel/domain/fighter'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import type { ActiveRoomSession } from '@/store'

/**
 * 석양이 진다 — 1:1 반응속도 대결.
 *
 * 신호등이 초록으로 바뀌는 순간 먼저 뽑은 쪽이 쏜다. 1ms까지 같으면 TIE고, 3발 맞으면
 * 쓰러진다. 신호 전에 뽑으면 경고가 쌓이고 두 개가 차면 자기 발을 쏜다(규칙은 서버 소유).
 *
 * 이 화면은 판정을 하지 않는다. 뽑은 순간의 반응 시간만 서버에 올리고, 서버가 내려준
 * 상태를 무대(Arena)가 이해하는 "지금 이 화면"으로 번역한다. 진영 번호는 서버가 주지
 * 않으므로 여기서 <b>나를 항상 왼쪽</b>에 두고 좌우를 매긴다.
 */

/** 결투가 끝났다 — 살아남은 쪽이 총을 내려놓고 서 있다. */
interface DuelResultProps {
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/**
 * 결과 색. 무승부는 이기지도 지지도 않았으므로 승리 초록도 패배 빨강도 아닌 본문 아이보리다 —
 * 색만 보고 결과를 읽는 사람에게 중립이 「이겼다」로 읽히면 안 된다.
 */
const OUTCOME_COLOR: Record<DuelOutcome, string> = {
  draw: 'var(--ds-duel-ink)',
  lost: 'var(--ds-duel-danger)',
  won: 'var(--ds-duel-positive)',
}

const OUTCOME_HEADING: Record<DuelOutcome, string> = {
  draw: '비겼다',
  lost: '쓰러졌다',
  won: '살아남았다',
}

export function DuelResult({ onLeaveRequest, session, snapshot }: DuelResultProps) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as DuelState | undefined
  // 대시보드는 승패의 당사자가 아니다 — "살아남았다"라고 말할 주체가 없다.
  if (session.membershipRole === 'dashboard') {
    return <DuelDashboardResult onClose={onLeaveRequest} snapshot={snapshot} state={state} />
  }
  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myHp = state?.hp[session.you] ?? 0
  const opponentHp = opponent ? (state?.hp[opponent.playerId] ?? 0) : 0
  const outcome = duelOutcome({
    fallenId: state?.lastRound?.koId,
    myHp,
    opponentHp,
    you: session.you,
  })
  const won = outcome === 'won'
  const host = isRoomHost(snapshot, session.you)

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={outcome === 'lost'}
          height="100%"
          outfit={won ? OUTFIT_LEFT : OUTFIT_RIGHT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        {/* 무승부에는 아무도 마지막까지 서 있지 않았다 — 눈썹 문구가 결과와 어긋나면 안 된다. */}
        {outcome === 'draw' ? 'Standoff' : 'Last man standing'}
      </p>
      <h1
        className="m-0 font-black"
        style={{
          color: OUTCOME_COLOR[outcome],
          fontSize: 'clamp(2.25rem, 6vw, 4.5rem)',
        }}
      >
        {OUTCOME_HEADING[outcome]}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={myHp} name="나" outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-white/35">:</span>
        <Ammo hp={opponentHp} name={opponent?.nickname ?? '상대'} outfit={OUTFIT_RIGHT} />
      </section>

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
          <p className="m-0 text-center text-sm text-white/60">
            호스트가 재대결을 준비하고 있어요.
          </p>
        )}
        <Button onClick={onLeaveRequest} size="lg" variant="secondary">
          방 나가기
        </Button>
      </div>
    </ResultBackdrop>
  )
}

/**
 * 파티 모드 큰 화면의 결과 — 누가 이겼는지 이름으로 말한다.
 *
 * 조작은 폰이 한다. 여기에는 "대기실로 돌아가기"를 두지 않는다 — 그건 방장(처음 들어온
 * 컨트롤러) 몫이고, TV 앞에서 누를 마우스를 기대하지 않는 것과 같은 이유다.
 */
export function DuelDashboardResult({
  onClose,
  snapshot,
  state,
}: {
  onClose: () => void
  snapshot: RoomSnapshot
  state: DuelState | undefined
}) {
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'
  const [first, second] = state?.playerOrder ?? []
  const fallen = state?.lastRound?.koId
  const survivor = fallen === first ? second : fallen === second ? first : undefined

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={survivor === second}
          height="100%"
          outfit={survivor === second ? OUTFIT_RIGHT : OUTFIT_LEFT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        {survivor ? 'Last man standing' : 'Standoff'}
      </p>
      <h1
        className="m-0 font-black"
        style={{
          // 승리 초록을 무승부에도 쓰고 있었다 — 글자만 「무승부」인데 색은 이겼다고 말했다.
          color: survivor ? 'var(--ds-duel-positive)' : 'var(--ds-duel-ink)',
          fontSize: 'clamp(2.25rem, 6vw, 4.5rem)',
        }}
      >
        {survivor ? `${nameOf(survivor)} 승리` : '무승부'}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={state?.hp[first ?? ''] ?? 0} name={nameOf(first)} outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-white/35">:</span>
        <Ammo hp={state?.hp[second ?? ''] ?? 0} name={nameOf(second)} outfit={OUTFIT_RIGHT} />
      </section>

      <p className="m-0 text-center text-sm text-white/60">
        방장이 폰에서 재대결을 시작할 수 있어요.
      </p>
      <Button onClick={onClose} size="lg" variant="secondary">
        방 닫기
      </Button>
    </ResultBackdrop>
  )
}
