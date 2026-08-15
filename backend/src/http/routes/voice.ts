import type { FastifyInstance } from 'fastify'
import type { VoiceIceService } from '../../ws/iceServers.js'

export interface VoiceRouteDependencies {
  readonly ice: VoiceIceService
}

/**
 * 음성 통화를 시작할 때 필요한 ICE 서버 목록.
 *
 * WebSocket이 아니라 REST인 이유: TURN 자격은 **시간제한 토큰**이라 방 전체에
 * 브로드캐스트하면 안 된다. `voice.peers`에 실으면 방에 있는 모두가 남의 자격을 갖는다.
 */
export const registerVoiceRoutes = async (
  app: FastifyInstance,
  deps: VoiceRouteDependencies,
): Promise<void> => {
  // `X-User-Id`는 발급 식별자로만 쓴다. 없으면 익명("guest")으로 발급한다 — 게스트도
  // 통화에 참여하므로 로그인을 전제할 수 없고, 자격의 보안은 secret과 만료 시각이 담당한다.
  app.get('/voice/ice', async (request) => {
    const header = request.headers['x-user-id']
    const userId = Array.isArray(header) ? header[0] : header
    return deps.ice.configFor(userId && userId.trim().length > 0 ? userId : 'guest')
  })
}
