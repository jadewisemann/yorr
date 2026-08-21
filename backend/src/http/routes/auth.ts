import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthOptions } from '../../auth/config.js'
import { SocialLoginError } from '../../auth/errors.js'
import type { GoogleOAuthClient } from '../../auth/googleClient.js'
import type { KakaoOAuthClient } from '../../auth/kakaoClient.js'
import type { LoginCodeStore } from '../../auth/loginCodeStore.js'
import { formUrlEncode } from '../../auth/oauthHttp.js'
import { resolveReturnUrl } from '../../auth/returnTo.js'
import type { SocialLoginService } from '../../auth/socialLoginService.js'
import type { SocialProfile, SocialProvider } from '../../auth/socialProfile.js'
import type { OAuthStateStore } from '../../auth/stateStore.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'

/**
 * 소셜 로그인 진입점 — backend-java `auth/controller/AuthController`.
 *
 * ```text
 * 프론트 로그인 버튼
 *   → GET  /auth/{provider}/authorize   state 발급 후 제공자로 302
 *   → (카카오 또는 구글 동의 화면)
 *   → GET  /auth/{provider}/callback    state 검증 · 토큰 교환 · 가입/로그인 · 세션 발급
 *                                       → 프론트로 302 (일회용 code 동반)
 *   → POST /auth/session                code를 세션 토큰으로 교환
 * ```
 *
 * 콜백이 세션 토큰을 URL에 직접 싣지 않는 이유는 `auth/loginCodeStore.ts` 참고.
 */
export interface AuthRouteDependencies {
  readonly users: UserService
  readonly options: AuthOptions
  readonly kakao: KakaoOAuthClient
  readonly google: GoogleOAuthClient
  readonly state: OAuthStateStore
  readonly loginCodes: LoginCodeStore
  readonly logins: SocialLoginService
}

interface AuthorizeQuery {
  readonly prompt?: string | string[]
  /** 로그인을 시작한 프론트 출처(`window.location.origin`). 목록에 없으면 무시된다. */
  readonly origin?: string | string[]
}

interface CallbackQuery {
  readonly code?: string | string[]
  readonly state?: string | string[]
  readonly error?: string | string[]
}

interface ProviderRoute {
  readonly provider: SocialProvider
  readonly path: string
  /** 이 값과 **정확히 같을 때만** 재인증을 요구한다(kakao `login`, google `select_account`). */
  readonly reauthPrompt: string
  authorizeUrl(deps: AuthRouteDependencies, state: string, reauth: boolean): string
  fetchProfile(deps: AuthRouteDependencies, code: string): Promise<SocialProfile>
}

const PROVIDERS: readonly ProviderRoute[] = [
  {
    provider: 'KAKAO',
    path: 'kakao',
    reauthPrompt: 'login',
    authorizeUrl: (deps, state, reauth) => deps.kakao.authorizeUrl(state, reauth),
    fetchProfile: (deps, code) => deps.kakao.fetchProfile(code),
  },
  {
    provider: 'GOOGLE',
    path: 'google',
    reauthPrompt: 'select_account',
    authorizeUrl: (deps, state, reauth) => deps.google.authorizeUrl(state, reauth),
    fetchProfile: (deps, code) => deps.google.fetchProfile(code),
  },
]

export const registerAuthRoutes = async (
  app: FastifyInstance,
  deps: AuthRouteDependencies,
): Promise<void> => {
  for (const route of PROVIDERS) {
    /**
     * 설정이 없으면 리다이렉트할 곳도 없다 — 브라우저가 **직접 여는 주소**라
     * 상태 코드로만 알린다(503, 빈 본문).
     */
    app.get(`/auth/${route.path}/authorize`, async (request, reply) => {
      const query = request.query as AuthorizeQuery
      const prompt = first(query.prompt)
      // 로그인을 **시작한 출처**로 되돌아가기 위한 값. 프론트가 자기 origin을 넘기고
      // 목록에 있는 것만 통과한다(`auth/returnTo.ts`). 없으면 설정값 그대로다.
      const returnUrl = resolveReturnUrl(deps.options, first(query.origin))
      try {
        // Java와 같은 순서다: state를 먼저 발급하고 URL을 만든다. 미설정 제공자에서는
        // 쓰이지 않는 state가 하나 남지만 5분 뒤 사라진다(동작 계약은 503 그대로).
        const url = route.authorizeUrl(
          deps,
          await deps.state.issue(returnUrl),
          prompt === route.reauthPrompt,
        )
        return redirect(reply, url)
      } catch (error) {
        if (!(error instanceof SocialLoginError)) throw error
        request.log.error({ err: error, provider: route.provider }, '로그인을 시작할 수 없습니다')
        return reply.code(503).send()
      }
    })

    /**
     * 제공자가 사용자를 되돌려 보내는 지점. **사람이 브라우저로 도착하는 곳이라
     * JSON을 돌려주지 않는다** — 성공이든 실패든 프론트 화면으로 302로 보내고,
     * 실패는 `?error=<reason>`으로 알린다.
     */
    app.get(`/auth/${route.path}/callback`, async (request, reply) => {
      const query = request.query as CallbackQuery
      // **error 검사보다 먼저 소비한다** — 실패 응답도 로그인을 시작한 출처로
      // 돌아가야 하고, 그 주소를 아는 곳이 state뿐이다. 사유 우선순위는 그대로다
      // (아래 validateCallback이 error를 먼저 본다). 달라지는 것은 취소된 콜백도
      // state를 태운다는 점뿐인데, 취소한 사용자는 authorize부터 다시 시작하므로
      // 그 state를 쓸 곳이 없다.
      const returnUrl = await deps.state.consume(first(query.state))
      const returnTo = returnUrl ?? deps.options.frontendRedirectUri
      try {
        const code = validateCallback(query, returnUrl)
        const profile = await route.fetchProfile(deps, code)
        const user = await deps.logins.loginOrRegister(
          route.provider,
          profile.providerUserId,
          profile.nickname,
          profile.profileImageUrl,
        )
        const sessionToken = await deps.users.openMemberSession(user.id, user.nickname)
        const loginCode = await deps.loginCodes.issue(sessionToken)
        return redirect(reply, frontendUrl(returnTo, 'code', loginCode))
      } catch (error) {
        if (!(error instanceof SocialLoginError)) throw error
        request.log.warn(
          { err: error, provider: route.provider, reason: error.reason },
          '소셜 로그인 실패',
        )
        return redirect(reply, frontendUrl(returnTo, 'error', error.reason))
      }
    })
  }

  /** 콜백이 넘긴 일회용 코드를 세션 토큰으로 바꾼다. 코드는 한 번만 쓸 수 있다. */
  app.post('/auth/session', async (request, reply) => {
    const body = (request.body ?? {}) as { code?: unknown }
    const code = typeof body.code === 'string' ? body.code : undefined
    const sessionToken = await deps.loginCodes.consume(code)
    if (sessionToken === undefined) return sendCode(reply, 401, 'invalid_login_code')
    // 세션이 실제로 살아 있는지까지 여기서 확인된다 — 토큰만 돌려주고 끝내지 않는다.
    return authenticated(deps, reply, sessionToken, sessionToken)
  })

  /**
   * 저장된 세션이 아직 살아 있는지 확인한다. 클라이언트는 로그인 상태를 로컬에
   * 두고 복원하는데, 그 사이 서버 세션이 사라졌으면 **화면은 로그인인데 요청은
   * 전부 401**인 상태가 된다. 앱이 뜰 때 한 번 물어보고 죽었으면 조용히 정리한다.
   */
  app.get('/auth/me', async (request, reply) =>
    authenticated(deps, reply, bearerToken(request), null),
  )

  /**
   * 로그아웃. 응답은 **항상 204**다 — 토큰이 이미 죽었든 살아 있든 클라이언트가
   * 할 일(로컬 정리)은 같고, 여기서 구분해 알려주면 "이 토큰이 유효한가"를 묻는
   * 도구가 된다.
   */
  app.delete('/auth/session', async (request, reply) => {
    await deps.users.closeSession(bearerToken(request))
    return reply.code(204).send()
  })
}

/**
 * 검증 **순서**가 계약이다: error 파라미터 → state 유효 → code 존재.
 * (state의 *소비*는 호출자가 먼저 했다 — 위 콜백 주석 참고. 판정 순서는 그대로다.)
 */
const validateCallback = (query: CallbackQuery, returnUrl: string | undefined): string => {
  const error = first(query.error)
  // 사용자가 동의 화면에서 취소하면 code 대신 이 값이 온다.
  if (error !== undefined && error.trim().length > 0) throw new SocialLoginError('canceled')
  if (returnUrl === undefined) throw new SocialLoginError('invalid_state')
  const code = first(query.code)
  if (code === undefined || code.trim().length === 0) {
    throw new SocialLoginError('provider_error', 'authorization_code_missing')
  }
  return code
}

/**
 * 세션 응답 한 모양. `sessionToken`은 교환(POST)에서만 실리고 `/auth/me`에서는
 * **null**이다(Java `SessionResponse`가 그대로 직렬화되는 모양).
 */
const authenticated = async (
  deps: AuthRouteDependencies,
  reply: FastifyReply,
  sessionToken: string | undefined,
  echoToken: string | null,
): Promise<FastifyReply> => {
  try {
    const identity = await deps.users.authenticateSession(sessionToken)
    return reply.code(200).send({
      userId: identity.userId,
      nickname: identity.nickname,
      type: identity.type,
      sessionToken: echoToken,
    })
  } catch (error) {
    if (!(error instanceof SessionAuthenticationError)) throw error
    return sendCode(reply, 401, 'session_expired')
  }
}

/** 헤더가 없거나 형식이 달라도 던지지 않는다 — 두 엔드포인트 모두 그 경우를 스스로 처리한다. */
const bearerToken = (request: FastifyRequest): string | undefined => {
  const header = first(request.headers.authorization)
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

const redirect = (reply: FastifyReply, url: string): FastifyReply =>
  reply.code(302).header('location', url).send()

/**
 * 프론트 복귀 주소에 파라미터 하나를 붙인다. 값만 인코딩하고 기존 쿼리는 건드리지
 * 않는다(Java `UriComponentsBuilder.queryParam().encode()`와 같은 결과).
 */
const frontendUrl = (returnTo: string, name: string, value: string): string => {
  const separator = returnTo.includes('?') ? '&' : '?'
  return `${returnTo}${separator}${name}=${formUrlEncode(value)}`
}

/** 같은 이름이 두 번 오면 Fastify가 배열로 준다 — 첫 값만 본다(Spring과 같다). */
const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value
