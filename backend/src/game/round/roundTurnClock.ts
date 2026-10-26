import { gameWsType } from '../module.js'
import type { RoundDeadlineScheduler } from './deadlineScheduler.js'
import type { RoundDeadlineStore } from './deadlineStore.js'
import type { RoundBroadcaster, RoundRoomSnapshot } from './roundPorts.js'
import type { RoundState } from './roundState.js'
import { EXPIRY_GRACE_MS, isBot, isUntimedRoom, ROUND_DURATION_MS } from './roundTiming.js'

/**
 * 턴 하나의 **시계를 걸고 `round.start`를 알리는** 일.
 *
 * `RoundTimerService`에서 갈라 둔 이유: 이쪽은 "언제 마감이고 무엇을 예약하는가"만
 * 알고, 서비스는 "이 턴을 시작할지 스킵할지"를 판단한다. 마감 규칙(연습 방은 시계
 * 없음, 봇 턴은 폴백 예약)이 한 파일에 모여 있어야 규칙을 바꿀 때 한 곳만 본다.
 *
 * 예약은 **사람에게 보이는 마감과 별개**다.
 * - 시계가 있는 방: 마감 그대로 예약한다(강제 진행만 {@link EXPIRY_GRACE_MS} 뒤로).
 * - 연습 방의 사람 턴: 예약하지 않는다. 이게 "제한 시간 없음"의 전부다.
 * - 연습 방의 **봇 턴: 화면에 시계가 없어도 예약은 남긴다.** 봇 스텝의 예외는
 *   삼켜지고 라운드 타이머가 유일한 폴백이기 때문이다(docs/design/games/yacht.md
 *   「실패 격리」). 없으면 봇 굴림이 한 번 실패한 연습 방은 영원히 멈춘다.
 */
export interface TurnClockPorts {
  readonly deadlineScheduler: RoundDeadlineScheduler
  readonly deadlineStore: RoundDeadlineStore
  readonly broadcaster: RoundBroadcaster
  readonly now: () => number
  readonly gameCode: string
  /** 마감 발화 — 예약기가 반환값을 기다린다(테스트가 즉시 발화를 기대한다). */
  onExpire: (roomId: string, roundNumber: number, activePlayerId: string) => void | Promise<void>
}

export interface ArmTurnInput {
  readonly roomId: string
  readonly state: RoundState
  readonly room: RoundRoomSnapshot | null
  /** 저장된 마감으로 되살리는 경우 그 값. `null`이면 지금 새로 계산한다. */
  readonly restored: { readonly deadline: number | null } | null
  /** 이 턴의 마감을 기록해 둘 곳(재접속 스냅샷용). */
  readonly remember: (roomId: string, roundNumber: number, deadline: number | null) => void
}

/** 마감을 계산·저장·예약하고 `round.start`를 방송한다. 반환값은 사람에게 보이는 마감. */
export const armTurn = async (
  ports: TurnClockPorts,
  input: ArmTurnInput,
): Promise<number | null> => {
  const { roomId, state, room, restored, remember } = input
  const roundNumber = state.roundNumber
  const activePlayerId = state.activePlayerId
  const deadline = restored
    ? restored.deadline
    : isUntimedRoom(room)
      ? null
      : ports.now() + ROUND_DURATION_MS
  remember(roomId, roundNumber, deadline)
  // 되살리는 경우는 이미 저장된 값이므로 다시 쓰지 않는다 — 같은 값을 쓰는 왕복이고,
  // 부팅 때 방 수만큼 불필요한 왕복이 늘어난다.
  if (restored === null) await ports.deadlineStore.save(roomId, { roundNumber, deadline })

  const expireAt =
    deadline ?? (isBot(room, activePlayerId) ? ports.now() + ROUND_DURATION_MS : null)
  if (expireAt !== null) {
    ports.deadlineScheduler.schedule(roomId, roundNumber, expireAt + EXPIRY_GRACE_MS, () =>
      ports.onExpire(roomId, roundNumber, activePlayerId),
    )
  }
  ports.broadcaster.broadcast(roomId, {
    type: gameWsType(ports.gameCode, 'round.start'),
    ts: ports.now(),
    payload: {
      roundNumber,
      deadline,
      activePlayerId,
      turnOrder: [...state.participantOrder],
    },
    roomId,
  })
  return deadline
}
