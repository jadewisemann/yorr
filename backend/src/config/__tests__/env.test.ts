import { describe, expect, it } from 'vitest'
import { loadEnv } from '../env.js'

/**
 * 환경변수 스킴 — 이름은 backend-java `application.yaml`이 **실제로 읽는 것**과
 * 같아야 한다(운영 `.env`를 그대로 재사용하는 것이 목적).
 *
 * `DB_URL`이 특히 그렇다: Java는 JDBC URL 하나만 받는데 Node는 호스트·포트·
 * 스키마로 쪼개 쓰므로, 운영 파일을 그대로 먹이려면 여기서 풀어 줘야 한다.
 */
describe('loadEnv — DB_URL 정렬', () => {
  /** 운영 `.env`(backend-java/.env.example)에 실제로 들어 있는 모양 그대로. */
  it('JDBC URL을 호스트·포트·스키마로 푼다', () => {
    const env = loadEnv({
      DB_URL:
        'jdbc:mysql://db.internal:3307/yorr?useSSL=false&serverTimezone=Asia/Seoul&characterEncoding=UTF-8',
    })

    expect(env.DB_HOST).toBe('db.internal')
    expect(env.DB_PORT).toBe(3307)
    expect(env.DB_NAME).toBe('yorr')
  })

  it('DB_URL이 쪼개진 변수를 이긴다', () => {
    const env = loadEnv({
      DB_URL: 'jdbc:mysql://from-url:3306/from_url',
      DB_HOST: 'from-split',
      DB_PORT: '13306',
      DB_NAME: 'from_split',
    })

    expect(env.DB_HOST).toBe('from-url')
    expect(env.DB_PORT).toBe(3306)
    expect(env.DB_NAME).toBe('from_url')
  })

  it('DB_URL이 없으면 기존 분해 변수를 그대로 쓴다', () => {
    const env = loadEnv({ DB_HOST: 'localhost', DB_PORT: '3306', DB_NAME: 'yorr_dev' })

    expect(env.DB_HOST).toBe('localhost')
    expect(env.DB_NAME).toBe('yorr_dev')
  })

  it('포트·스키마가 없으면 기본값으로 채운다', () => {
    const env = loadEnv({ DB_URL: 'jdbc:mysql://only-host', DB_NAME: 'fallback' })

    expect(env.DB_HOST).toBe('only-host')
    expect(env.DB_PORT).toBe(3306)
    expect(env.DB_NAME).toBe('fallback')
  })

  /** 조용히 localhost로 붙는 것이 가장 나쁘다 — 운영에서 엉뚱한 DB를 보게 된다. */
  it('읽을 수 없는 DB_URL은 기동을 막는다', () => {
    expect(() => loadEnv({ DB_URL: 'not a url' })).toThrow(/DB_URL/)
  })

  it('소셜 로그인 변수 이름과 기본값은 application.yaml과 같다', () => {
    const defaults = loadEnv({})

    expect(defaults.AUTH_FRONTEND_REDIRECT_URI).toBe('http://localhost:5173/auth/callback')
    expect(defaults.KAKAO_CLIENT_ID).toBe('')
    expect(defaults.KAKAO_CLIENT_SECRET).toBe('')
    expect(defaults.KAKAO_REDIRECT_URI).toBe('http://localhost:8080/api/v1/auth/kakao/callback')
    expect(defaults.GOOGLE_REDIRECT_URI).toBe('http://localhost:8080/api/v1/auth/google/callback')
    expect(loadEnv({ KAKAO_CLIENT_ID: 'key' }).KAKAO_CLIENT_ID).toBe('key')
  })
})
