import { DomainError } from '../errors.js'
import type { GameStartResult } from '../room/roomService.js'
import type { InboundEnvelope } from '../ws/envelope.js'
import type { WsRoomSnapshot } from '../ws/protocol.js'
import type { ClientSocket } from '../ws/socket.js'
import { GameCatalog, type GameMetadata, normalizeGameCode } from './catalog.js'

/**
 * 게임 하나 = 모듈 하나.
 *
 * **정원·시작 인원·봇 지원 여부는 여기 없다.** `GAME_CATALOG`가 유일한 출처이고
 * 레지스트리가 그 표를 흡수한다(`registry.require(code)`) — 모듈이 다시 선언하면
 * 방 정원이 두 곳으로 갈라진다. 모듈이 채우는 것은 **코드와 동작**뿐이다.
 */
export interface GameModule {
  /** 대문자 정규 코드. 레지스트리 키이자 WS 네임스페이스(소문자화)다. */
  readonly code: string

  /**
   * 방 phase 전이 **후** 게임 상태 초기화. `game`은 방금 START Lua가 만든 결과
   * (gameId + 전이 후 스냅샷)다. 실패하면 던져서 롤백을 유도한다.
   */
  start(roomCode: string, game: GameStartResult): Promise<void>

  /** 로비 복귀 정리. */
  reset(roomCode: string): Promise<void>

  /** 재접속 스냅샷(docs/design/reconnect.md). 게임 상태는 `game` 필드에 싣는다. */
  reconnect(roomCode: string, playerId: string): Promise<WsRoomSnapshot>

  /** 타이머만 중단/재개 — 상태는 그대로 둔다. */
  pause(roomCode: string): Promise<void>
  resume(roomCode: string): Promise<void>

  /** 게임 중 이탈 처리(턴 순서·명단 정리까지). */
  removePlayer(roomCode: string, playerId: string): Promise<void>

  /** 방 소멸 — 타이머 + 상태 폐기. */
  close(roomCode: string): Promise<void>

  /** 진행 중 게임 존재 여부(빈 방 유예 30초/10분 선택에 쓰인다). */
  hasState(roomCode: string): Promise<boolean>

  /** **접두사가 벗겨진** 이벤트명(`dice.roll`)으로 판정한다. */
  handles(eventType: string): boolean
  handle(socket: ClientSocket, message: InboundEnvelope): Promise<void>
}

/**
 * WS 코어가 게임 모듈에서 실제로 쓰는 훅들의 부분집합. 모듈이 없는 방(아직 이식되지 않은 게임)은
 * 핸들러의 대역이 이 모양을 대신 채운다.
 */
export type RoomGameHooks = Pick<
  GameModule,
  'pause' | 'resume' | 'close' | 'hasState' | 'removePlayer' | 'reconnect'
>

/**
 * 게임 모듈이 소유한 이벤트의 **공개 WS 타입**을 조립한다. `game.over`·`state.sync`도 방의 게임 코드로
 * 네임스페이스가 붙는다.
 */
export const gameWsType = (
  gameCode: string | null | undefined,
  eventType: string | null | undefined,
): string => {
  if (!gameCode?.trim() || !eventType?.trim()) throw new DomainError('invalid_game_event_type')
  return `game.${gameCode.toLowerCase()}.${eventType}`
}

/**
 * 등록된 게임 모듈 + 메타데이터 카탈로그. 부팅 배선이 `register`를 부른다.
 * 코드 정규화(`trim().toUpperCase()`)·중복 거부·교차 네임스페이스 거부를 여기서
 * 강제한다.
 *
 * **모듈이 없는 게임 코드는 정상이다**: 카탈로그에는
 * 세 게임이 다 있지만 모듈은 게임별 슬라이스(3.x)가 하나씩 채운다. 그래서
 * 코드 조회(`require`)와 모듈 조회(`byCode`)를 분리했다.
 */
export class GameModuleRegistry {
  private readonly modules = new Map<string, GameModule>()

  constructor(private readonly catalog: GameCatalog = new GameCatalog()) {}

  /** 카탈로그에 없는 코드·중복 등록은 **기동 실패**다. */
  register(module: GameModule): void {
    const code = this.catalog.canonicalCode(module.code)
    if (this.modules.has(code)) throw new Error('duplicate_game_code')
    this.modules.set(code, module)
  }

  /** 게임 메타데이터. 모르는 코드는 `invalid_game_code`. */
  require(code: string | null | undefined): GameMetadata {
    return this.catalog.require(code)
  }

  canonicalCode(code: string | null | undefined): string {
    return this.catalog.canonicalCode(code)
  }

  supportedCodes(): string[] {
    return this.catalog.supportedCodes()
  }

  /** 등록된 모듈. 모르는 코드도 **던지지 않는다** — 없으면 `undefined`. */
  byCode(code: string | null | undefined): GameModule | undefined {
    return this.modules.get(normalizeGameCode(code))
  }

  all(): GameModule[] {
    return [...this.modules.values()]
  }

  /**
   * 방의 게임 코드로 모듈을 찾아 게임 네임스페이스 메시지를 넘긴다.
   *
   * 통과 조건: ① 그 코드의 모듈이 있고 ② type이 `game.<code소문자>.`로 시작하고
   * (다른 게임 네임스페이스는 거부) ③ 접두사를 벗긴 이벤트명을 모듈이 `handles`.
   * 어느 하나라도 불통과면 `false` — 호출자(게이트웨이)가 `INVALID_MESSAGE`로 답한다.
   *
   * @returns 모듈이 실제로 처리했는지
   */
  async dispatch(
    gameCode: string | null | undefined,
    socket: ClientSocket,
    message: InboundEnvelope,
  ): Promise<boolean> {
    const module = this.byCode(gameCode)
    if (!module) return false

    const prefix = `game.${module.code.toLowerCase()}.`
    if (!message.type.startsWith(prefix)) return false

    const eventType = message.type.slice(prefix.length)
    if (!module.handles(eventType)) return false

    // 봉투는 타입만 갈아끼워 그대로 넘긴다 — ts·payload·roomId·msgId는 모듈이 쓴다.
    await module.handle(socket, { ...message, type: eventType })
    return true
  }
}
