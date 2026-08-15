import { createHmac } from 'node:crypto'
import type { Env } from '../config/env.js'

/**
 * WebRTC ICE 서버 목록 발급.
 * 브라우저의 `RTCConfiguration.iceServers`로 그대로 간다.
 *
 * **TURN 자격을 REST로 발급하는 이유**: 고정 ID/비밀번호를 쓰면 프론트 JS에 그대로 노출돼
 * 외부인이 중계 대역폭을 공짜로 쓴다. coturn의 `use-auth-secret` 방식으로 짧은 수명의
 * 자격을 그때그때 만든다. 방 전체에 방송하면 안 되므로 `voice.peers`가 아니라 REST다
 * (docs/design/voice.md).
 *
 * TURN이 설정되지 않은 환경(로컬 개발·인프라 구축 전)에서는 **STUN만** 돌려준다 —
 * 같은 NAT 안에서는 그것만으로 통화가 붙어 개발이 막히지 않는다.
 */
interface IceServer {
  readonly urls: string[]
  readonly username?: string
  readonly credential?: string
}

/** 프론트 `realtime/voice/iceServers.ts`가 읽는 계약. */
export interface VoiceIceConfig {
  readonly iceServers: IceServer[]
  readonly ttlSeconds: number
}

export interface VoiceIceOptions {
  /** coturn의 static-auth-secret과 같은 값. 비어 있으면 TURN을 내보내지 않는다. */
  readonly turnSecret: string
  /** coturn이 떠 있는 호스트. 비어 있으면 TURN을 내보내지 않는다. */
  readonly turnHost: string
  readonly stunUrl: string
  readonly ttlSeconds: number
}

export const voiceIceOptions = (env: Env): VoiceIceOptions => ({
  turnSecret: env.YORR_VOICE_TURN_SECRET,
  turnHost: env.YORR_VOICE_TURN_HOST,
  stunUrl: env.YORR_VOICE_STUN_URL,
  ttlSeconds: env.YORR_VOICE_TURN_TTL_SECONDS,
})

export class VoiceIceService {
  constructor(
    private readonly options: VoiceIceOptions,
    /** 시임 — 테스트가 만료 시각을 고정한다. */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * @param identifier 자격에 섞는 식별자(playerId 등). 서버 로그에서 어느 발급인지 알아보는
   *   용도라 비밀이 아니어도 된다 — 보안은 secret과 만료 시각이 담당한다.
   */
  configFor(identifier: string): VoiceIceConfig {
    const { turnSecret, turnHost, stunUrl, ttlSeconds } = this.options
    const iceServers: IceServer[] = [{ urls: [stunUrl] }]

    // 둘 중 하나만 설정된 상태는 "TURN 미설정"이다 — 반쪽짜리 자격을 내보내면
    // 브라우저가 붙지 않는 서버로 계속 재시도한다.
    if (turnSecret.trim().length > 0 && turnHost.trim().length > 0) {
      const username = `${Math.floor(this.now() / 1000) + ttlSeconds}:${identifier}`
      iceServers.push({
        urls: [
          `turn:${turnHost}:3478?transport=udp`,
          `turn:${turnHost}:3478?transport=tcp`,
          // TLS 5349는 UDP가 막힌 망에서 유일하게 통과하는 경로다.
          `turns:${turnHost}:5349?transport=tcp`,
        ],
        username,
        credential: this.sign(username, turnSecret),
      })
    }
    return { iceServers, ttlSeconds }
  }

  /** coturn REST 규약: credential = base64(HMAC-SHA1(secret, username)). */
  private sign(username: string, secret: string): string {
    return createHmac('sha1', secret).update(username, 'utf8').digest('base64')
  }
}
