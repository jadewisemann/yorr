import { z } from 'zod'

// backend-java의 application.yaml과 같은 환경변수 이름을 유지한다 —
// 운영 전환 시 .env 파일을 그대로 재사용하기 위해서다.
const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(8080),
  CORS_ALLOWED_ORIGINS: z.string().default('https://yorr.site'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('yorr'),
  DB_USERNAME: z.string().default('yorr'),
  DB_PASSWORD: z.string().default(''),
  // 음성(coturn ICE 자격). Java에는 yaml 항목이 없고 `@Value("${yorr.voice.*}")`로만
  // 존재하는데, Spring의 relaxed binding이 그 프로퍼티를 아래 환경변수 이름에서 읽는다
  // (`.`·`-` → `_` 치환 후 대문자) — 운영 `.env`를 그대로 재사용하려면 이 이름이어야 한다.
  /** coturn static-auth-secret. `""` = TURN 미제공(STUN만). */
  YORR_VOICE_TURN_SECRET: z.string().default(''),
  /** coturn 호스트. `""` = TURN 미제공(STUN만). */
  YORR_VOICE_TURN_HOST: z.string().default(''),
  YORR_VOICE_STUN_URL: z.string().default('stun:stun.l.google.com:19302'),
  YORR_VOICE_TURN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
})

export type Env = z.infer<typeof envSchema>

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source)

export const allowedOrigins = (env: Env): string[] =>
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
