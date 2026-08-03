/**
 * ICE 서버 설정이 사는 유일한 자리.
 *
 * 지금은 공용 STUN만 쓴다. STUN은 "내 공인 주소가 뭐냐"만 알려주므로 서로 다른 NAT 뒤에
 * 있는 10~20%는 직접 연결에 실패한다 — 그 경우를 메우는 TURN(중계)은 자격증명이 시간제한
 * 토큰이라 서버가 발급해야 하고, 그래서 상수가 아니라 `GET /api/v1/voice/ice` 응답이 된다.
 *
 * TURN 도입은 확정됐고(정원 6인 · 싸피 서버 UDP 개방 확인) 백엔드 엔드포인트를 기다리는
 * 중이다. 갈아끼울 때 이 파일 하나만 고치면 되도록 호출부는 `loadIceServers()`만 본다.
 */

/** 엔드포인트가 없거나 실패했을 때 쓰는 값. 이것만으로도 같은 NAT 안에서는 통화가 붙는다. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** 서버가 내려주는 모양. 백엔드 `GET /api/v1/voice/ice`와 같은 계약이다. */
interface IceConfigResponse {
  iceServers: RTCIceServer[]
  ttlSeconds: number
}

/**
 * TURN 자격증명을 받아온다. 아직 엔드포인트가 없으므로 실패는 정상 경로다 —
 * 통화를 막지 않고 STUN만으로 진행한다(붙는 조합에서는 그대로 통화가 된다).
 *
 * ⚠️ 자격증명에 수명이 있으므로 결과를 앱 수명 내내 캐시하면 안 된다. 통화를 시작할 때마다
 *    부른다 — 6인 방에서 한 번씩이라 호출량이 문제 되는 규모가 아니다.
 */
export async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch('/api/v1/voice/ice', { credentials: 'include' })
    if (!response.ok) return FALLBACK_ICE_SERVERS
    const config = (await response.json()) as IceConfigResponse
    // 서버가 빈 배열을 주면 STUN도 없이 연결을 시도하게 된다 — 그건 fallback이 낫다.
    if (!Array.isArray(config.iceServers) || config.iceServers.length === 0) {
      return FALLBACK_ICE_SERVERS
    }
    return config.iceServers
  } catch {
    return FALLBACK_ICE_SERVERS
  }
}
