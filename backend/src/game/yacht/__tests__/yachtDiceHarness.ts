import { beforeEach } from 'vitest'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import type { InboundEnvelope } from '../../../ws/envelope.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import {
  InMemoryRoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  seededDieRoller,
} from '../../round/index.js'
import { ScoreConfirmationService, ScoreRoundSubmissionService } from '../../score/index.js'
import { YachtDiceGameModule } from '../yachtDiceGameModule.js'
import { YachtTurnActionService } from '../yachtTurnActionService.js'
import {
  FakeRealtimeSnapshots,
  FakeReconnectSnapshots,
  FakeRoundTimer,
  FakeScoreBoardStore,
  FakeSocket,
  NO_HELD,
} from './testDoubles.js'

/**
 * 야추 모듈의 **dice·submit 케이스**.
 *
 * 핸들러가 `registry.dispatch`로 넘긴 뒤 응답을 **모듈이 직접** 만들므로 검증
 * 대상도 모듈이다 — 게이트웨이·핸들러 경로는 별도 스위트가 덮는다.
 *
 * 브로드캐스터·레지스트리는 **진짜**를 쓴다: 확인해야 할 것의 절반이 "같은
 * 프레임이 방 전원에게 한 번 직렬화되어 나가는가"와 정확한 JSON 문자열이라,
 * 대역으로 바꾸면 그 계약이 테스트에서 사라진다.
 */

/**
 * 모듈 한 벌과 그 모듈에 말을 거는 봉투 헬퍼들. 검사 쪽은 자기 `beforeEach`에서 이
 * 객체를 구조 분해해 받는다 — 여기 등록된 `beforeEach`가 먼저 돌아 새 인스턴스를
 * 만들어 두기 때문에 순서가 맞는다.
 */
export const ROOM = 'room-a'
export const OTHER_ROOM = 'room-b'
export const TS = 1_700_000_000_000

export function useYachtModule() {
  let registry: RoomSessionRegistry
  let broadcaster: RoomBroadcaster
  let rounds: RoundSynchronizationService
  let timers: FakeRoundTimer
  let scoreBoards: FakeScoreBoardStore
  let realtimeSnapshots: FakeRealtimeSnapshots
  let reconnectSnapshots: FakeReconnectSnapshots
  let module: YachtDiceGameModule
  let playerA: FakeSocket
  let playerB: FakeSocket

  beforeEach(() => {
    registry = new RoomSessionRegistry()
    broadcaster = new RoomBroadcaster()
    rounds = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
      dieRoller: seededDieRoller(31337),
    })
    timers = new FakeRoundTimer()
    scoreBoards = new FakeScoreBoardStore()
    realtimeSnapshots = new FakeRealtimeSnapshots()
    reconnectSnapshots = new FakeReconnectSnapshots()
    const submissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(
      rounds,
      new ScoreConfirmationService(scoreBoards),
      { getSnapshot: async () => ({ gameId: 'game-a' }) },
    )
    const actions = new YachtTurnActionService(
      { rounds, timers, broadcaster, submissions },
      { now: () => TS },
    )
    module = new YachtDiceGameModule(
      {
        rounds,
        timers,
        actions,
        seats: registry,
        realtimeSnapshots,
        reconnectSnapshots,
        broadcaster,
      },
      { now: () => TS },
    )
    playerA = new FakeSocket()
    playerB = new FakeSocket()
  })

  /* ------------------------------------------------------------------ 준비 */

  const seat = (socket: FakeSocket, playerId: string, roomId = ROOM): void => {
    registry.join(roomId, socket, playerId, playerId.toUpperCase())
    broadcaster.register(roomId, socket)
  }

  const envelope = (
    type: string,
    payload: unknown,
    msgId: string,
    roomId: string | undefined = ROOM,
  ): InboundEnvelope => ({ type, ts: TS, payload, roomId, msgId })

  const rollEnvelope = (rollCount: number, msgId: string, held = NO_HELD): InboundEnvelope =>
    envelope('dice.roll', { roundNumber: 1, rollCount, held }, msgId)

  const holdEnvelope = (held: readonly boolean[], msgId: string): InboundEnvelope =>
    envelope('dice.hold', { roundNumber: 1, held }, msgId)

  const submitEnvelope = async (msgId: string, roomId?: string): Promise<InboundEnvelope> => {
    const state = await rounds.findByRoomId(ROOM)
    const dice = state?.activeDice ?? [1, 2, 3, 4, 5]
    return envelope(
      'round.submit',
      { roundNumber: 1, dice: [...dice], category: 'choice' },
      msgId,
      roomId,
    )
  }

  const errorOf = (socket: FakeSocket): { code: string; message: string; refMsgId?: string } =>
    socket.last().payload as { code: string; message: string; refMsgId?: string }

  return {
    get registry() {
      return registry
    },
    get broadcaster() {
      return broadcaster
    },
    get rounds() {
      return rounds
    },
    get timers() {
      return timers
    },
    get scoreBoards() {
      return scoreBoards
    },
    get realtimeSnapshots() {
      return realtimeSnapshots
    },
    get reconnectSnapshots() {
      return reconnectSnapshots
    },
    get module() {
      return module
    },
    get playerA() {
      return playerA
    },
    get playerB() {
      return playerB
    },
    seat,
    envelope,
    rollEnvelope,
    holdEnvelope,
    submitEnvelope,
    errorOf,
  }
}
