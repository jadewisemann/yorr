import { createHmac } from 'node:crypto'
import fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../../config/env.js'
import { VoiceIceService, voiceIceOptions } from '../../../ws/iceServers.js'
import { registerVoiceRoutes } from '../voice.js'

/**
 * `GET /voice/ice` — backend-java `ws/voice/VoiceIceController`·`VoiceIceService`.
 * Redis를 타지 않는 순수 라우트라 서버 전체를 띄우지 않는다.
 */

interface IceResponse {
  iceServers: { urls: string[]; username?: string; credential?: string }[]
  ttlSeconds: number
}

const NOW_MS = 1_700_000_000_000

const call = async (
  env: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: IceResponse }> => {
  const app = fastify({ logger: false })
  const ice = new VoiceIceService(voiceIceOptions(loadEnv(env)), () => NOW_MS)
  await app.register(async (api) => registerVoiceRoutes(api, { ice }), { prefix: '/api/v1' })
  const response = await app.inject({ method: 'GET', url: '/api/v1/voice/ice', headers })
  await app.close()
  return { statusCode: response.statusCode, json: response.json() as IceResponse }
}

describe('GET /voice/ice', () => {
  /** TURN 미설정(로컬 개발)에서도 같은 NAT 안에서는 통화가 붙어야 한다. */
  it('TURN이 설정되지 않으면 STUN만 돌려준다', async () => {
    const { statusCode, json } = await call({})

    expect(statusCode).toBe(200)
    expect(json.ttlSeconds).toBe(600)
    expect(json.iceServers).toHaveLength(1)
    expect(json.iceServers[0]?.urls).toEqual(['stun:stun.l.google.com:19302'])
    expect(json.iceServers[0]?.username).toBeUndefined()
  })

  /** 반쪽짜리 설정으로 자격을 내보내면 붙지 않는 서버로 계속 재시도한다. */
  it('secret·host 중 하나만 있으면 TURN을 내보내지 않는다', async () => {
    const onlySecret = await call({ YORR_VOICE_TURN_SECRET: 's3cret' })
    const onlyHost = await call({ YORR_VOICE_TURN_HOST: 'turn.yorr.site' })

    expect(onlySecret.json.iceServers).toHaveLength(1)
    expect(onlyHost.json.iceServers).toHaveLength(1)
  })

  it('둘 다 설정되면 coturn 규약대로 단명 자격을 발급한다', async () => {
    const { json } = await call(
      {
        YORR_VOICE_TURN_SECRET: 's3cret',
        YORR_VOICE_TURN_HOST: 'turn.yorr.site',
        YORR_VOICE_TURN_TTL_SECONDS: '120',
      },
      { 'X-User-Id': 'player-a' },
    )

    const turn = json.iceServers[1]
    expect(json.ttlSeconds).toBe(120)
    expect(turn?.urls).toEqual([
      'turn:turn.yorr.site:3478?transport=udp',
      'turn:turn.yorr.site:3478?transport=tcp',
      // UDP가 막힌 망에서 유일하게 통과하는 경로.
      'turns:turn.yorr.site:5349?transport=tcp',
    ])
    // username = (만료 epoch초):식별자, credential = base64(HMAC-SHA1(secret, username))
    expect(turn?.username).toBe(`${NOW_MS / 1000 + 120}:player-a`)
    expect(turn?.credential).toBe(
      createHmac('sha1', 's3cret')
        .update(turn?.username ?? '')
        .digest('base64'),
    )
  })

  /** 게스트도 통화에 참여하므로 로그인을 전제할 수 없다. */
  it('X-User-Id가 없으면 guest로 발급한다', async () => {
    const anonymous = await call({
      YORR_VOICE_TURN_SECRET: 's3cret',
      YORR_VOICE_TURN_HOST: 'turn.yorr.site',
    })
    const blank = await call(
      { YORR_VOICE_TURN_SECRET: 's3cret', YORR_VOICE_TURN_HOST: 'turn.yorr.site' },
      { 'X-User-Id': '   ' },
    )

    expect(anonymous.json.iceServers[1]?.username).toBe(`${NOW_MS / 1000 + 600}:guest`)
    expect(blank.json.iceServers[1]?.username).toBe(`${NOW_MS / 1000 + 600}:guest`)
  })

  it('STUN 주소는 환경변수로 바꿀 수 있다', async () => {
    const { json } = await call({ YORR_VOICE_STUN_URL: 'stun:stun.yorr.site:3478' })

    expect(json.iceServers[0]?.urls).toEqual(['stun:stun.yorr.site:3478'])
  })
})
