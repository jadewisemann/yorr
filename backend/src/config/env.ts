import { z } from 'zod'

/**
 * `jdbc:mysql://host:3306/db?params` → 풀이 쓰는 좌표.
 *
 * - `jdbc:` 접두는 URL 표준 스킴이 아니라 벗겨 내야 `URL`이 읽는다.
 * - **쿼리 파라미터는 일부러 무시한다.** 운영 값에 `serverTimezone=Asia/Seoul`이
 *   들어 있는데, 그것을 따르면 `timezone: 'Z'`로 막아 둔 9시간 어긋남이
 *   그대로 되살아난다(persistence.md의 `finished_at` 계약). SSL·인코딩 옵션도
 *   mysql2에서는 이름이 다르므로 옮기지 않는다.
 * - userinfo(`user:pass@`)도 무시한다 — `DB_USERNAME`·`DB_PASSWORD`가 URL 안의
 *   값을 이기는 것이 계약이다.
 */
const parseJdbcMysqlUrl = (
  value: string,
): { host: string; port: number; database?: string } | null => {
  const raw = value.trim()
  const withoutJdbc = raw.startsWith('jdbc:') ? raw.slice('jdbc:'.length) : raw
  let url: URL
  try {
    url = new URL(withoutJdbc)
  } catch {
    return null
  }
  if (url.hostname.length === 0) return null
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  return {
    // IPv6 리터럴은 `URL`이 대괄호째로 준다. mysql2는 대괄호 없는 주소를 원한다.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? 3306 : Number(url.port),
    ...(database.length === 0 ? {} : { database }),
  }
}

// 환경변수 이름은 구 스택과 같게 유지한다 — 운영 `.env` 파일을 그대로
// 재사용하기 위해서다(docs/design/operations.md 「환경변수」).
const envSchema = z
  .object({
    SERVER_PORT: z.coerce.number().int().positive().default(8080),
    CORS_ALLOWED_ORIGINS: z.string().default('https://yorr.site'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().default(''),
    /**
     * **운영 `.env`가 실제로 담고 있는 MySQL 좌표**다. 구 스택이 JDBC URL 하나로
     * 받던 값이라 그 형식 그대로 들어온다
     * (예: `jdbc:mysql://localhost:3306/yorr?useSSL=false&...`).
     *
     * 값이 있으면 아래 `DB_HOST`·`DB_PORT`·`DB_NAME`을 **덮어쓴다** — 쪼개진
     * 세 변수는 Node 쪽에서만 쓰던 편의 변수이고, 둘이 어긋날 때 운영 파일에
     * 적힌 쪽이 이기는 것이 안전하다. 셋을 계속 두는 이유는 `infra/mysql.ts`와
     * 로컬 `.env.example`이 그 모양을 쓰고 있어서다(DB_URL 미설정 = 기존 동작).
     */
    DB_URL: z.string().default(''),
    DB_HOST: z.string().default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_NAME: z.string().default('yorr'),
    DB_USERNAME: z.string().default('yorr'),
    DB_PASSWORD: z.string().default(''),
    // 음성(coturn ICE 자격). 이 이름들은 운영 `.env`가 이미 담고 있는 것이라
    // 그대로 유지한다.
    /** coturn static-auth-secret. `""` = TURN 미제공(STUN만). */
    YORR_VOICE_TURN_SECRET: z.string().default(''),
    /** coturn 호스트. `""` = TURN 미제공(STUN만). */
    YORR_VOICE_TURN_HOST: z.string().default(''),
    YORR_VOICE_STUN_URL: z.string().default('stun:stun.l.google.com:19302'),
    YORR_VOICE_TURN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    // 소셜 로그인. 이름·기본값은 운영 `.env`의 것을 그대로 유지한다.
    // 값이 비어 있어도 서버는 뜬다 — 로그인 엔드포인트를 호출할 때만 거절한다.
    /** 로그인을 끝낸 사용자를 되돌려 보낼 **프론트** 주소(제공자 콘솔 등록값이 아니다). */
    AUTH_FRONTEND_REDIRECT_URI: z.string().default('http://localhost:5173/auth/callback'),
    /** 카카오 앱의 REST API 키(JavaScript 키가 아니다 — 토큰 교환은 서버가 한다). */
    KAKAO_CLIENT_ID: z.string().default(''),
    /** 선택. 콘솔에서 발급 후 "사용함"으로 바꿔야 실제로 적용된다. */
    KAKAO_CLIENT_SECRET: z.string().default(''),
    /** 카카오 콘솔 등록값과 문자 하나까지 같아야 한다(다르면 KOE006). */
    KAKAO_REDIRECT_URI: z.string().default('http://localhost:8080/api/v1/auth/kakao/callback'),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default('http://localhost:8080/api/v1/auth/google/callback'),
  })
  .transform((env, ctx) => {
    if (env.DB_URL.trim().length === 0) return env
    const coordinates = parseJdbcMysqlUrl(env.DB_URL)
    if (coordinates === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_URL'],
        message: `DB_URL을 MySQL 좌표로 읽을 수 없다: ${env.DB_URL}`,
      })
      return z.NEVER
    }
    return {
      ...env,
      DB_HOST: coordinates.host,
      DB_PORT: coordinates.port,
      DB_NAME: coordinates.database ?? env.DB_NAME,
    }
  })

export type Env = z.infer<typeof envSchema>

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source)

export const allowedOrigins = (env: Env): string[] =>
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
