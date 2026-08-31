import { describe, expect, it } from 'vitest'
import { allowedOrigins, loadEnv } from '../env.js'

/**
 * 환경변수 스킴 — 이름은 운영 `.env`에 실제로 들어 있는 것과 같아야 한다.
 *
 * `DB_URL`이 특히 그렇다: 운영 파일은 JDBC URL 하나로 들고 있는데 Node는
 * 호스트·포트·스키마로 쪼개 쓰므로, 그 파일을 그대로 먹이려면 여기서 풀어 준다.
 */
describe('loadEnv — DB_URL 정렬', () => {
  /** 운영 `.env`에 실제로 들어 있는 모양 그대로. */
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
