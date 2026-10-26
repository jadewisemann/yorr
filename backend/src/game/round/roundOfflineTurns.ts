import type { RoundPresence, RoundRoomSnapshot } from './roundPorts.js'
import type { RoundState } from './roundState.js'
import type { RoundSynchronizationService } from './roundSynchronizationService.js'
import type { TurnAdvanceInput } from './roundTimerPorts.js'
import { isBot, MAX_OFFLINE_TURNS } from './roundTiming.js'

/**
 * **오프라인 턴** 처리 — 명단 판정, 결석 횟수 누적, 첫 스킵과 자동 퇴장.
 *
 * 턴 시계(`roundTimerService.ts`)에서 갈라 둔 이유는 이쪽이 "지금 이 사람에게
 * 소켓이 있는가"만 알기 때문이다. 시계는 마감 시각과 방송 순서를 다룬다.
 *
 * 규칙(주석은 `roundTimerService.ts`의 `beginTurn` 참고):
 * - 첫 오프라인 턴은 점수 없이 스킵한다
 * - {@link MAX_OFFLINE_TURNS}번째 턴은 자동 퇴장시킨다
 * - 봇은 소켓이 없다 — 명단으로 판정하면 매 턴 스킵되어 봇이 플레이할 수 없다
 */
export interface OfflineTurnPorts {
  readonly presence: RoundPresence
  readonly synchronizationService: RoundSynchronizationService
  removePlayer(roomId: string, playerId: string): Promise<void>
  advanceTurn(roomId: string, input: TurnAdvanceInput): Promise<void>
}

export class OfflineTurns {
  /** roomId → (playerId → 오프라인으로 맞은 자기 턴 수). 재접속하면 지운다. */
  private readonly misses = new Map<string, Map<string, number>>()

  constructor(private readonly ports: OfflineTurnPorts) {}

  /**
   * 턴 주인이 오프라인인가. 명단에 없는 플레이어(비정상 상태)도 오프라인으로 본다 —
   * 연결이 없다는 사실은 같다.
   */
  isOffline(room: RoundRoomSnapshot | null, roomId: string, playerId: string): boolean {
    // 봇은 소켓이 없다 — 명단으로 판정하면 매 턴 오프라인 스킵되어 봇이 플레이할 수 없다.
    if (isBot(room, playerId)) return false
    const member = this.ports.presence.find(roomId, playerId)
    return member === null || member.status === 'offline'
  }

  /** 재접속 복귀 시 호출 — 오프라인 결석 횟수를 처음부터 다시 센다. */
  clear(roomId: string, playerId: string): void {
    const misses = this.misses.get(roomId)
    if (misses === undefined) return
    misses.delete(playerId)
    if (misses.size === 0) this.misses.delete(roomId)
  }

  /** 방이 끝났다 — 장부를 통째로 버린다. */
  forgetRoom(roomId: string): void {
    this.misses.delete(roomId)
  }

  /**
   * 오프라인 턴을 진행한다. 한도에 닿으면 자동 퇴장, 아니면 무득점 스킵이다.
   * 스킵·퇴장 뒤의 다음 턴은 `advanceTurn`을 다시 거치므로 연속 오프라인도 연쇄된다.
   */
  async handle(roomId: string, state: RoundState): Promise<void> {
    const playerId = state.activePlayerId
    let misses = this.misses.get(roomId)
    if (misses === undefined) {
      misses = new Map()
      this.misses.set(roomId, misses)
    }
    const count = (misses.get(playerId) ?? 0) + 1
    misses.set(playerId, count)

    if (count >= MAX_OFFLINE_TURNS) {
      await this.ports.removePlayer(roomId, playerId)
      return
    }
    const expired = await this.ports.synchronizationService.expire(
      roomId,
      state.roundNumber,
      playerId,
    )
    if (expired !== undefined) {
      await this.ports.advanceTurn(roomId, { score: null, round: expired })
    }
  }
}
