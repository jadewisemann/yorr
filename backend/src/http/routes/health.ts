import type { FastifyInstance } from 'fastify'

// Spring Actuator와 같은 경로를 유지한다 — 배포 파이프라인·모니터링의
// 헬스체크 대상 경로를 바꾸지 않고 서버 구현만 갈아끼우기 위해서다.
export const registerHealthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/actuator/health', async () => ({ status: 'UP' }))
}
