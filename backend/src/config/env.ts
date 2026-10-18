import { z } from 'zod'

// 환경변수 이름은 운영 `.env`에 이미 들어 있는 것을 그대로 쓴다 — 이름을
// 바꾸면 배포 호스트의 파일을 함께 고쳐야 하고, 그 둘이 어긋나면 부팅이 깨진다.
const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(8080),
  CORS_ALLOWED_ORIGINS: z.string().default('https://yorr.site'),
  /** 영속 DB 파일(`infra/sqlite.ts`). 작업 디렉터리 기준이며 첫 질의 때 만든다. */
  SQLITE_PATH: z.string().default('data/yorr.db'),
  // 소셜 로그인. 이름·기본값은 운영 `.env`에 들어 있는 것 그대로다.
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

export type Env = z.infer<typeof envSchema>

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source)

/**
 * 콤마 목록 → 허용 출처 배열. REST(`server.ts`의 `@fastify/cors`)와 WS 핸드셰이크
 * (`ws/gateway.ts`의 `verifyClient`)가 **이 함수 하나**로 같은 목록을 받는다.
 *
 * 끝의 `/`를 떼는 이유: 브라우저가 보내는 `Origin`에는 경로가 없다
 * (`https://yorr.site`). `https://yorr.site/`라고 적어 두면 정확 일치가 **영원히**
 * 실패하는데, 증상은 CORS 403 하나뿐이라 원인을 찾기 어렵다. 도메인을 새로 붙일 때
 * 실제로 밟는 지점이므로 여기서 정규화한다(`*`는 그대로 남아 gateway의 와일드카드
 * 분기가 계속 동작한다).
 */
export const allowedOrigins = (env: Env): string[] =>
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0)
