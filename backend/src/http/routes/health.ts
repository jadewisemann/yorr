import type { FastifyInstance } from 'fastify'
import {
  type MetricsCollector,
  PROMETHEUS_CONTENT_TYPE,
  type ReadinessPort,
} from '../../monitoring/index.js'

export interface ActuatorRouteDependencies {
  /**
   * readiness 판정기(`ReadinessService`). Redis·MySQL을 실제로 두드려 이 인스턴스가
   * 요청을 처리할 수 있는지 본다(`monitoring/readiness.ts`).
   *
   * 배선하지 않으면 `/actuator/health`는 **항상 503이다.** 그것이 안전한 방향이다 —
   * 컨테이너가 healthy가 되지 못하므로 `up -d --wait`가 배포를 거절하고, 누락이
   * 조용한 초록이 아니라 실패로 드러난다(prometheus 라우트와 같은 규약). 무엇이
   * 빠졌는지는 등록 시점의 로그가 말해 준다.
   */
  readonly readiness?: ReadinessPort
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
  // 예전에는 상수 `{status:'UP'}`이었다. 그때 이 엔드포인트는 "프로세스가 HTTP를
  // 받는다"까지만 증명했고, Redis·MySQL이 둘 다 죽어도 UP을 냈다 —
  // 이미지 `HEALTHCHECK`·배포 게이트·외부 uptime 체크가 그 한계를 함께 물려받았다
  // (deploy/PLAN.md PR 1). 지금은 readiness다.
  //
  // 본문 형식은 계약이라 그대로 둔다: 200 `{"status":"UP"}` / 503 `{"status":"DOWN"}`.
  // **어느 의존이 죽었는지는 싣지 않는다** — 인증 없이 공개되는 표면이다.
  if (deps.readiness === undefined) {
    app.log.error('readiness 판정기가 배선되지 않았습니다 — /actuator/health가 항상 503을 냅니다')
  }
  app.get('/actuator/health', async (_request, reply) => {
    const readiness = deps.readiness
    if (readiness === undefined) return reply.code(503).send({ status: 'DOWN' })

    const result = await readiness.check()
    if (!result.ready) return reply.code(503).send({ status: 'DOWN' })
    return { status: 'UP' }
  })

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
