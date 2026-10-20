import type {
  RoundBroadcaster,
  RoundPresence,
  RoundRoomService,
  ScoreRoundSubmissionOutcome,
} from './roundPorts.js'
import type { RoundSubmissionResult } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'

/**
 * 게임 중 이탈 확정의 단일 경로 — 명시적 나가기(REST·WS room.leave)와 오프라인
 * 자동 퇴장이 전부 여기로 모인다.
 *
 * 왜 분리했나: 이 경로는 "명단에서 지운다 → 방송한다 → 턴 순서에서 뺀다 → 필요하면
 * 턴을 넘기거나 라운드를 버린다"는 순서가 계약이다. 타이머의 시계 관리와 섞여 있으면
 * 그 순서가 어느 함수에 있는지 매번 찾아야 한다.
 */

export interface PlayerRemovalDeps {
  readonly broadcaster: RoundBroadcaster
  readonly now: () => number
  readonly presence: RoundPresence
  readonly roomService: RoundRoomService
  readonly synchronizationService: RoundSynchronizationService
  /** 진행 중인 자기 턴을 만료시키고 다음 턴으로 넘긴다. */
  readonly advanceTurn: (
    roomId: string,
    input: ScoreRoundSubmissionOutcome<RoundSubmissionResult>,
  ) => Promise<void>
  /** 라운드 상태와 타이머를 통째로 버린다. */
  readonly cancelRoom: (roomId: string) => Promise<void>
  /** 오프라인 결석 횟수를 지운다(재접속 복귀·퇴장). */
  readonly clearOfflineMisses: (roomId: string, playerId: string) => void
}

export async function removePlayerFromRound(
  deps: PlayerRemovalDeps,
  roomId: string,
  playerId: string,
): Promise<void> {
  deps.clearOfflineMisses(roomId, playerId)
  const removed = deps.presence.removePlayer(roomId, playerId)
  await deps.roomService.leave(roomId, playerId)
  if (removed !== null) {
    deps.broadcaster.broadcast(roomId, {
      // 방 이벤트는 게임 네임스페이스가 붙지 않는다.
      type: 'room.player_left',
      ts: deps.now(),
      payload: { playerId },
      roomId,
    })
  }

  const state = await deps.synchronizationService.findByRoomId(roomId)
  if (state === undefined || state.finished || !state.participantIds.has(playerId)) {
    return
  }
  if (state.participantOrder.length === 1) {
    // 마지막 참가자까지 나갔다 — 이어갈 턴이 없으니 라운드 상태와 타이머를 통째로 버린다.
    await deps.cancelRoom(roomId)
    await deps.synchronizationService.remove(roomId)
    return
  }
  if (state.activePlayerId === playerId) {
    // 진행 중인 자기 턴은 만료 경로로 넘겨 라운드 완료·게임 종료 판정을 한 곳에 유지한다.
    const expired = await deps.synchronizationService.expire(roomId, state.roundNumber, playerId)
    const updated = await deps.synchronizationService.removeParticipant(roomId, playerId)
    if (expired !== undefined && updated !== undefined) {
      await deps.advanceTurn(roomId, {
        score: null,
        round: { state: updated, completedRound: expired.completedRound },
      })
    }
    return
  }
  await deps.synchronizationService.removeParticipant(roomId, playerId)
}
