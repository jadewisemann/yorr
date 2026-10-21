import type { GameCode } from '@/games'
import type { GameOverPayload, RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'
import type { useAppStore } from '@/store'

/**
 * 서버 메시지 → 스토어 반영 **디스패치 표**.
 *
 * 왜 분리했나: 20갈래 `switch`가 `RealtimeSync.tsx`에 있으면 컴포넌트 파일 하나를
 * 읽는 데 와이어 계약 전체를 통과해야 하고, 사이클로매틱 복잡도도 24까지 올라간다
 * (QUALITY.md 2단계가 권하는 "조회 테이블로 치환"이 이 자리다). 표로 바꾸면
 * **계약이 한눈에 보이고**, 새 메시지는 행 하나를 더하는 일이 된다.
 *
 * 표에 없는 타입은 조용히 무시한다 — 프론트가 모르는 메시지를 받아도 화면이
 * 깨지지 않는다는 계약이다.
 */

export type Store = ReturnType<typeof useAppStore.getState>

export type MessageHandler = (message: ServerMessage, store: Store) => void

/** 봉투가 아니라 **payload만** 받는 핸들러(기존 `apply*` 함수들의 모양). */
type PayloadHandler<P> = (payload: P, store: Store) => void

/**
 * 봉투에서 그 타입의 payload를 꺼낸다.
 *
 * 표의 키로 이미 타입을 확인했으므로 여기서는 단언이 안전하다 — 런타임 검증은
 * `parseInbound`(봉투)와 각 리듀서가 하고, 이 함수는 모양만 좁힌다.
 */
const payloadOf = (message: ServerMessage): never => message.payload as never

export interface DispatchDependencies {
  /** `sys.connected`의 하트비트 간격을 받아 타이머를 건다. */
  readonly startHeartbeat: (intervalMs: number) => void
  /** `state.sync` 계열이 게임 상태를 덮어쓰지 않게 보존한다. */
  readonly keepGameState: (snapshot: RoomSnapshot, current: RoomSnapshot | null) => RoomSnapshot
  readonly applyRoomJoined: (
    payload: Extract<ServerMessage, { type: 'room.joined' }>['payload'],
    store: Store,
  ) => void
  readonly applyPlayerJoined: PayloadHandler<
    Extract<ServerMessage, { type: 'room.player_joined' }>['payload']
  >
  readonly applyPlayerLeft: PayloadHandler<
    Extract<ServerMessage, { type: 'room.player_left' }>['payload']
  >
  readonly applyPresenceUpdate: PayloadHandler<
    Extract<ServerMessage, { type: 'presence.update' }>['payload']
  >
  readonly applyScoreUpdate: PayloadHandler<
    Extract<ServerMessage, { type: 'game.yacht_dice.score.update' }>['payload']
  >
  readonly applyRoundStart: PayloadHandler<
    Extract<ServerMessage, { type: 'game.yacht_dice.round.start' }>['payload']
  >
  /** 이 하나만 봉투 전체를 받는다 — `msgId`로 "내 굴림"을 판별한다. */
  readonly applyDiceBroadcast: (
    message: Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>,
    store: Store,
  ) => void
  readonly applyGameOver: (payload: GameOverPayload, store: Store) => void
  /** 게임 상태 덮어쓰기 — 페이로드는 게임마다 다르므로 호출자가 좁힌다. */
  readonly applyModuleGameState: (
    payload: ModuleStatePayload,
    gameCode: GameCode,
    store: Store,
  ) => void
  readonly applyServerError: PayloadHandler<Extract<ServerMessage, { type: 'error' }>['payload']>
}

/** 세 게임의 `state` 메시지 페이로드 합집합. */
export type ModuleStatePayload = Extract<
  ServerMessage,
  { type: 'game.ping_pong.state' | 'game.duel.state' | 'game.davinci_code.state' }
>['payload']

/** 동기화 스냅샷을 그대로 받아들이는 타입 — 여러 이벤트가 이 한 갈래를 공유한다. */
const SYNC_TYPES = [
  'sys.reconnected',
  'state.sync',
  'game.yacht_dice.state.sync',
  'game.ping_pong.state.sync',
  'game.duel.state.sync',
  'game.davinci_code.state.sync',
] as const

/** 게임 종료 — 방의 게임 코드만 다르고 처리(순위·전적)는 같다. */
const GAME_OVER_TYPES = [
  'game.yacht_dice.game.over',
  'game.ping_pong.game.over',
  'game.duel.game.over',
  'game.davinci_code.game.over',
] as const

/** 게임 상태 덮어쓰기 — 페이로드 모양이 게임마다 다르지만 저장 방식은 같다. */
const MODULE_STATE_TYPES: readonly (readonly [string, GameCode])[] = [
  ['game.ping_pong.state', 'PING_PONG'],
  ['game.duel.state', 'DUEL'],
  ['game.davinci_code.state', 'DAVINCI_CODE'],
]

export const createMessageDispatcher = (deps: DispatchDependencies): MessageHandler => {
  const table: Record<string, MessageHandler> = {
    'sys.connected': (message) => {
      if (message.type !== 'sys.connected') return
      const interval = message.payload.heartbeatIntervalMs
      if (typeof interval === 'number') deps.startHeartbeat(interval)
    },
    'room.joined': (message, store) => {
      if (message.type === 'room.joined') deps.applyRoomJoined(message.payload, store)
    },
    'room.player_joined': (message, store) => {
      deps.applyPlayerJoined(payloadOf(message), store)
    },
    'room.player_left': (message, store) => {
      deps.applyPlayerLeft(payloadOf(message), store)
    },
    'presence.update': (message, store) => {
      deps.applyPresenceUpdate(payloadOf(message), store)
    },
    'game.yacht_dice.score.update': (message, store) => {
      deps.applyScoreUpdate(payloadOf(message), store)
    },
    'game.yacht_dice.round.start': (message, store) => {
      deps.applyRoundStart(payloadOf(message), store)
    },
    'game.yacht_dice.dice.broadcast': (message, store) => {
      deps.applyDiceBroadcast(
        message as Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>,
        store,
      )
    },
    'room.closed': (_message, store) => store.endSession('room_closed'),
    error: (message, store) => {
      deps.applyServerError(payloadOf(message), store)
    },
  }

  for (const type of SYNC_TYPES) {
    table[type] = (message, store) => {
      if (!('snapshot' in message.payload)) return
      store.replaceRoomSnapshot(
        deps.keepGameState(message.payload.snapshot as RoomSnapshot, store.roomSnapshot),
      )
    }
  }

  for (const type of GAME_OVER_TYPES) {
    table[type] = (message, store) => {
      deps.applyGameOver(payloadOf(message), store)
    }
  }

  for (const [type, gameCode] of MODULE_STATE_TYPES) {
    table[type] = (message, store) => {
      deps.applyModuleGameState(message.payload as ModuleStatePayload, gameCode, store)
    }
  }

  return (message, store) => {
    table[message.type]?.(message, store)
  }
}
