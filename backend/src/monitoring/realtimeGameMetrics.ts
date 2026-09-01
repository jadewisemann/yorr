import { type GaugeFamily, renderGauges } from './exposition.js'

/**
 * 실시간 게임 게이지.
 *
 * **수집 출처는 WS 레지스트리의 인메모리 상태다.** Redis를 왕복하지 않는다 —
 * 스크레이프 주기마다 Redis에 SCAN을 던지면 스크레이프가
 * 방 상태의 부하 원인이 된다. 단일 인스턴스 전제(DESIGN.md 원칙 8)라 구독·phase가
 * 인메모리에 있고, 그래서 이 값이 곧 이 프로세스의 진실이다.
 */
export interface MetricsPresence {
  /** 인메모리 phase가 PLAYING인 방 수. */
  activeRoomCount(): number
  /**
   * 그 게임의 PLAYING 방에서 **라이브 소켓**을 가진 플레이어 수.
   * 오프라인 좌석(자리는 있고 소켓은 없는 상태)은 제외된다 — 계약이다.
   */
  activeParticipantCount(gameCode: string): number
}

/** `GameCatalog`·`GameModuleRegistry` 둘 다 만족한다(후자는 카탈로그에 위임한다). */
export interface MetricsGameCodeSource {
  supportedCodes(): string[]
}

export interface RealtimeGameMetricsDependencies {
  /** WS 게이트웨이와 **같은** `RoomSessionRegistry`여야 한다. 새로 만들면 영구히 0이다. */
  readonly presence: MetricsPresence
  readonly games: MetricsGameCodeSource
}

/** `/actuator/prometheus` 핸들러가 보는 최소 표면. */
export interface MetricsCollector {
  render(): string
}

/** 이름·태그가 계약이다(docs/design/operations.md 「모니터링」). 바꾸면 대시보드가 끊긴다. */
const ROOMS_ACTIVE = 'yorr_rooms_active'
const GAME_PARTICIPANTS_ACTIVE = 'yorr_game_participants_active'

export class RealtimeGameMetrics implements MetricsCollector {
  constructor(private readonly deps: RealtimeGameMetricsDependencies) {}

  /**
   * 스크레이프 시점에 세는 pull 모델이다.
   * 카운터를 따로 들고 증감시키지 않는 이유: 상태 전이(offline 전이·소켓 교체·방 폐쇄)마다
   * 갱신을 빼먹으면 게이지가 조용히 어긋난다.
   */
  collect(): GaugeFamily[] {
    return [
      {
        name: ROOMS_ACTIVE,
        help: '현재 게임을 진행 중인 전체 방 수',
        samples: [{ value: this.deps.presence.activeRoomCount() }],
      },
      {
        name: GAME_PARTICIPANTS_ACTIVE,
        help: '게임별 현재 WebSocket 연결 참가자 수',
        // 게임 코드는 **대문자 그대로** 태그 값이 된다(WS 네임스페이스와 달리 소문자화 X).
        samples: this.deps.games.supportedCodes().map((code) => ({
          labels: { game: code },
          value: this.deps.presence.activeParticipantCount(code),
        })),
      },
    ]
  }

  render(): string {
    return renderGauges(this.collect())
  }
}
