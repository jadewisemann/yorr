import { kakaoConfigured, type ProviderConfig } from './config.js'
import { SocialLoginError } from './errors.js'
import { formUrlEncode, getJson, postForm, type SocialHttpOptions } from './oauthHttp.js'
import { firstNotBlank, providerNickname, type SocialProfile } from './socialProfile.js'

const AUTHORIZE_URI = 'https://kauth.kakao.com/oauth/authorize'
const TOKEN_URI = 'https://kauth.kakao.com/oauth/token'
const USER_INFO_URI = 'https://kapi.kakao.com/v2/user/me'

/**
 * 카카오 OAuth. 인가 코드를 토큰으로 바꾸고 프로필을 읽어오는 두 가지 일만 한다.
 */
export class KakaoOAuthClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: SocialHttpOptions = {},
  ) {}

  /**
   * 사용자를 보낼 카카오 동의 화면 주소.
   *
   * 값을 직접 form-urlencode한다 — redirect_uri는 카카오 콘솔 등록값과 문자
   * 하나까지 같아야 하고(KOE006), 인코딩하지 않으면 값에 특수문자가 섞이는
   * 순간 제공자가 파라미터를 잘라 읽는다.
   *
   * @param forceLogin 우리 쪽에서 로그아웃해도 카카오 세션은 브라우저에 남아
   *   다음 로그인이 동의 화면 없이 통과한다. 계정을 바꾸려는 사용자만 이 길로
   *   재인증을 강제한다(기본은 빠른 재로그인 유지).
   */
  authorizeUrl(state: string, forceLogin: boolean): string {
    this.requireConfigured()
    return (
      `${AUTHORIZE_URI}?response_type=code` +
      `&client_id=${formUrlEncode(this.config.clientId)}` +
      `&redirect_uri=${formUrlEncode(this.config.redirectUri)}` +
      `&state=${formUrlEncode(state)}` +
      (forceLogin ? '&prompt=login' : '')
    )
  }

  /**
   * 인가 코드로 프로필을 가져온다. 액세스 토큰은 여기서만 쓰고 저장하지 않는다 —
   * 우리가 카카오 API를 대신 호출할 일이 없고, 보관하면 유출 표면만 넓어진다.
   */
  async fetchProfile(code: string): Promise<SocialProfile> {
    this.requireConfigured()
    const accessToken = await this.exchangeToken(code)
    const user = await this.fetchUser(accessToken)
    const id = user.id
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new SocialLoginError('provider_error', 'kakao_user_id_missing')
    }
    return {
      providerUserId: String(id),
      nickname: providerNickname(user.profile?.nickname, user.properties?.nickname),
      profileImageUrl: firstNotBlank(
        user.profile?.profile_image_url,
        user.properties?.profile_image,
      ),
    }
  }

  private async exchangeToken(code: string): Promise<string> {
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
    }
    // secret은 "사용함"으로 켰을 때만 보낸다 — 끈 앱에 보내면 카카오가 거절한다.
    if (this.config.clientSecret.trim().length > 0) {
      form.client_secret = this.config.clientSecret
    }
    let body: unknown
    try {
      body = await postForm(TOKEN_URI, form, this.http)
    } catch (error) {
      // 응답 본문에 사유가 담겨 있어도 그대로 흘리지 않는다 — 클라이언트 키가 섞여 나올 수 있다.
      throw generalize(error, 'kakao_token_exchange_failed')
    }
    const accessToken = (body as { access_token?: unknown } | null)?.access_token
    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      throw new SocialLoginError('provider_error', 'kakao_token_missing')
    }
    return accessToken
  }

  private async fetchUser(accessToken: string): Promise<KakaoUser> {
    let body: unknown
    try {
      body = await getJson(USER_INFO_URI, accessToken, this.http)
    } catch (error) {
      throw generalize(error, 'kakao_user_fetch_failed')
    }
    const user = (body ?? {}) as KakaoUserResponse
    return {
      id: user.id,
      // 동의항목을 거절하면 kakao_account · profile이 통째로 없을 수 있다.
      profile: user.kakao_account?.profile,
      // 구형 필드. 앱 설정에 따라 프로필이 이쪽으로만 오는 경우가 있어 둘 다 본다.
      properties: user.properties,
    }
  }

  private requireConfigured(): void {
    if (!kakaoConfigured(this.config)) throw new SocialLoginError('not_configured')
  }
}

/** 제공자 쪽 실패는 사유를 가리지 않고 하나로 뭉갠다 — 본문·상태 코드를 밖으로 내보내지 않는다. */
const generalize = (error: unknown, detail: string): SocialLoginError =>
  error instanceof SocialLoginError
    ? error
    : new SocialLoginError('provider_error', detail, { cause: error })

interface KakaoProfileFields {
  readonly nickname?: unknown
  readonly profile_image_url?: unknown
}

interface KakaoLegacyProperties {
  readonly nickname?: unknown
  readonly profile_image?: unknown
}

interface KakaoUserResponse {
  readonly id?: unknown
  readonly kakao_account?: { readonly profile?: KakaoProfileFields }
  readonly properties?: KakaoLegacyProperties
}

interface KakaoUser {
  readonly id: unknown
  readonly profile: KakaoProfileFields | undefined
  readonly properties: KakaoLegacyProperties | undefined
}
