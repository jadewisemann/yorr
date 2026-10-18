import { describe, expect, it } from 'vitest'
import { allowedOrigins, loadEnv } from '../env.js'

/** 환경변수 스킴 — 이름은 운영 패널에 넣는 것과 같아야 한다. */
describe('loadEnv', () => {
  it('DB 파일은 기본으로 작업 디렉터리의 data/yorr.db다', () => {
    expect(loadEnv({}).SQLITE_PATH).toBe('data/yorr.db')
    expect(loadEnv({ SQLITE_PATH: '/srv/yorr.db' }).SQLITE_PATH).toBe('/srv/yorr.db')
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

/**
 * 허용 출처는 REST와 WS가 같은 목록을 쓰는 **유일한 문자열 하나**에서 나온다
 * (`allowedOrigins`). 프론트 도메인을 갈아 끼울 때 여기가 유일한 조정 지점이므로,
 * 그 파싱 규칙을 테스트로 못박는다 — 틀리면 증상이 CORS 403 하나뿐이다.
 */
describe('allowedOrigins — 프론트 출처 목록', () => {
  it('기본값은 운영 도메인 하나다', () => {
    expect(allowedOrigins(loadEnv({}))).toEqual(['https://yorr.site'])
  })

  it('콤마 목록의 공백과 빈 항목을 흘려보내지 않는다', () => {
    const env = loadEnv({
      CORS_ALLOWED_ORIGINS: 'https://yorr.site, http://localhost:5173,,',
    })

    expect(allowedOrigins(env)).toEqual(['https://yorr.site', 'http://localhost:5173'])
  })

  /**
   * 브라우저의 `Origin`에는 경로가 없다 — 끝의 `/`를 그대로 두면 정확 일치가
   * 영원히 실패한다. 도메인 전환에서 실제로 밟는 지점이다.
   */
  it('끝의 슬래시를 떼어 브라우저가 보내는 Origin과 맞춘다', () => {
    const env = loadEnv({ CORS_ALLOWED_ORIGINS: 'https://yorr.site/,https://www.yorr.site//' })

    expect(allowedOrigins(env)).toEqual(['https://yorr.site', 'https://www.yorr.site'])
  })

  it('와일드카드는 그대로 남는다(gateway의 `*` 분기가 계속 동작한다)', () => {
    expect(allowedOrigins(loadEnv({ CORS_ALLOWED_ORIGINS: '*' }))).toEqual(['*'])
  })
})
