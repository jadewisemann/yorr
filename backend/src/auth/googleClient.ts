import { googleConfigured, type ProviderConfig } from './config.js'
import { SocialLoginError } from './errors.js'
import { formUrlEncode, getJson, postForm, type SocialHttpOptions } from './oauthHttp.js'
import { blankToNull, providerNickname, type SocialProfile } from './socialProfile.js'

const AUTHORIZE_URI = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const USER_INFO_URI = 'https://openidconnect.googleapis.com/v1/userinfo'
const SCOPE = 'openid profile email'

/** Google OAuth. */
export class GoogleOAuthClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly http: SocialHttpOptions = {},
  ) {}

  /** @param selectAccount 계정을 다시 고르게 한다(`prompt=select_account`). */
  authorizeUrl(state: string, selectAccount: boolean): string {
    this.requireConfigured()
    return (
      `${AUTHORIZE_URI}?response_type=code` +
      `&client_id=${formUrlEncode(this.config.clientId)}` +
      `&redirect_uri=${formUrlEncode(this.config.redirectUri)}` +
      `&scope=${formUrlEncode(SCOPE)}` +
      `&state=${formUrlEncode(state)}` +
      (selectAccount ? '&prompt=select_account' : '')
    )
  }

  async fetchProfile(code: string): Promise<SocialProfile> {
    this.requireConfigured()
    const accessToken = await this.exchangeToken(code)
    const user = await this.fetchUser(accessToken)
    const subject = blankToNull(user.sub)
    if (subject === null) {
      throw new SocialLoginError('provider_error', 'google_user_id_missing')
    }
    return {
      providerUserId: subject,
      nickname: providerNickname(user.name, user.email),
      profileImageUrl: blankToNull(user.picture),
    }
  }

  private async exchangeToken(code: string): Promise<string> {
    let body: unknown
    try {
      body = await postForm(
        TOKEN_URI,
        {
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
          code,
        },
        this.http,
      )
    } catch (error) {
      throw generalize(error, 'google_token_exchange_failed')
    }
    const accessToken = (body as { access_token?: unknown } | null)?.access_token
    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      throw new SocialLoginError('provider_error', 'google_token_missing')
    }
    return accessToken
  }

  private async fetchUser(accessToken: string): Promise<GoogleUserResponse> {
    try {
      return ((await getJson(USER_INFO_URI, accessToken, this.http)) ?? {}) as GoogleUserResponse
    } catch (error) {
      throw generalize(error, 'google_user_fetch_failed')
    }
  }

  private requireConfigured(): void {
    if (!googleConfigured(this.config)) throw new SocialLoginError('not_configured')
  }
}

/** 제공자 쪽 실패는 사유를 가리지 않고 하나로 뭉갠다 — 본문·상태 코드를 밖으로 내보내지 않는다. */
const generalize = (error: unknown, detail: string): SocialLoginError =>
  error instanceof SocialLoginError
    ? error
    : new SocialLoginError('provider_error', detail, { cause: error })

interface GoogleUserResponse {
  readonly sub?: unknown
  readonly name?: unknown
  readonly email?: unknown
  readonly picture?: unknown
}
