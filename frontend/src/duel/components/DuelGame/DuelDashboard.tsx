import type { RefObject } from 'react'
import { Arena } from '@/duel/components/Arena'
import { MAX_FOULS, MAX_HP } from '@/duel/domain/duel'
import { buildStage } from '@/duel/domain/stage'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'

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

/**
 * 파티 모드 큰 화면 — 관전이다.
 *
 * 조작이 없다: 뽑는 것은 폰(컨트롤러)이 하고 이 화면은 결투를 보여 준다. 두 총잡이를 서버가
 * 준 순서(playerOrder)대로 세우고 닉네임으로 부른다 — 대시보드는 명단에 없으므로 "나"라고
 * 부를 사람이 없다. 총알도 로컬 신호가 없어 판정과 함께 들어온다(누른 사람이 없으니 맞다).
 */
export function DuelDashboard({
  flight,
  impact,
  impactDelayMs,
  onClose,
  snapshot,
  stageRef,
  state,
}: {
  flight: number
  impact: boolean
  impactDelayMs: number
  onClose: () => void
  snapshot: RoomSnapshot
  stageRef: RefObject<HTMLElement | null>
  state: DuelState
}) {
  const [first, second] = state.playerOrder
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'

  return (
    <main
      className="relative flex h-svh w-full flex-col overflow-hidden bg-duel-canvas text-white select-none"
      ref={stageRef}
    >
      <Arena
        {...buildStage({
          impact,
          opponentId: second ?? '',
          opponentName: nameOf(second),
          state,
          you: first ?? '',
          youName: nameOf(first),
          // 관전 화면은 방아쇠를 당기지 않는다 — 두 총알 모두 판정으로 알게 된다.
          youShot: null,
        })}
        actLabel="DRAW!"
        flightMs={flight}
        fxKey={state.round}
        hint="폰에서 뽑습니다"
        impactDelayMs={impactDelayMs}
        maxFouls={MAX_FOULS}
        maxHp={MAX_HP}
        round={state.round}
      />

      <GameChromeButton
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20"
        tone="overlay"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </GameChromeButton>
    </main>
  )
}
