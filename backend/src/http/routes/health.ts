import type { FastifyInstance } from 'fastify'
import { type MetricsCollector, PROMETHEUS_CONTENT_TYPE } from '../../monitoring/index.js'

export interface ActuatorRouteDependencies {
  /**
   * 실시간 게임 게이지 수집기(`RealtimeGameMetrics`). WS 게이트웨이와 **같은**
   * 레지스트리를 받은 인스턴스여야 한다 — 새로 만들면 값이 영구히 0이다.
   *
   * 선택인 이유는 배선 없이도 컴파일이 되기 때문이 아니라, **배선 누락을 404가 아니라
   * 503으로 드러내기 위해서다**(auth 라우트의 미설정 503과 같은 규약,
   * docs/design/operations.md). 스크레이프가 조용히 200/빈 본문으로 성공하는 것이 최악이다.
   */
  readonly metrics?: MetricsCollector
}

// Spring Actuator와 같은 경로를 유지한다 — 배포 파이프라인·모니터링의
// 헬스체크 대상 경로를 바꾸지 않고 서버 구현만 갈아끼우기 위해서다.
// **노출은 health·prometheus 둘뿐이다**(env·beans·metrics 같은 나머지 액추에이터
// 엔드포인트는 만들지 않는다 — Spring Boot에서도 노출하지 않았고, 방·세션 정보가
// 인증 없이 새는 표면을 늘리지 않는다).
export const registerHealthRoutes = async (
  app: FastifyInstance,
  deps: ActuatorRouteDependencies = {},
): Promise<void> => {
  app.get('/actuator/health', async () => ({ status: 'UP' }))

  // `yorr_rooms_active`·`yorr_game_participants_active{game}` — 이름·태그가 계약이다.
  app.get('/actuator/prometheus', async (_request, reply) => {
    const metrics = deps.metrics
    if (!metrics) {
      return reply
        .code(503)
        .type(PROMETHEUS_CONTENT_TYPE)
        .send('# metrics collector not wired (metrics_unavailable)\n')
    }
    return reply.type(PROMETHEUS_CONTENT_TYPE).send(metrics.render())
  })
}
