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
})

export type Env = z.infer<typeof envSchema>

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source)

export const allowedOrigins = (env: Env): string[] =>
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
