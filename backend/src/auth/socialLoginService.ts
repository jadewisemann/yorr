import { DataIntegrityViolationError } from './errors.js'
import type { SocialAccountRegistrar, SocialAccountRepository } from './socialAccountStore.js'
import { type MemberUser, PLACEHOLDER_NICKNAME, type SocialProvider } from './socialProfile.js'

/**
 * "있으면 로그인, 없으면 가입"을 정하는 한 곳.
 *
 * 이 분기는 동시 요청에서 **깨진다.** 같은 사람이 로그인 버튼을 두 번 누르면 두
 * 요청이 모두 "없음"을 보고 나란히 가입을 시도한다. 최종 방어선은
 * `social_accounts(provider, provider_user_id)` 유니크 제약이고, 여기서는 그
 * 위반을 실패가 아니라 **"누군가 방금 먼저 가입했다"는 신호로** 받아 다시
 * 조회한다.
 */
export class SocialLoginService {
  constructor(
    private readonly socialAccounts: SocialAccountRepository,
    private readonly registrar: SocialAccountRegistrar,
  ) {}

  async loginOrRegister(
    provider: SocialProvider,
    providerUserId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    const existing = await this.socialAccounts.findUserByProviderAccount(provider, providerUserId)
    if (existing === undefined) {
      return this.registerOrRecover(provider, providerUserId, nickname, profileImageUrl)
    }
    // 임시 이름으로 가입된 회원이라면 이번에 받은 진짜 이름을 받아 적는다(그때만).
    if (existing.nickname === PLACEHOLDER_NICKNAME && nickname !== PLACEHOLDER_NICKNAME) {
      return this.registrar.adoptProviderProfile(existing.id, nickname, profileImageUrl)
    }
    return existing
  }

  private async registerOrRecover(
    provider: SocialProvider,
    providerUserId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    try {
      return await this.registrar.register(provider, providerUserId, nickname, profileImageUrl)
    } catch (error) {
      if (!(error instanceof DataIntegrityViolationError)) throw error
      // 경쟁 요청이 한발 먼저 가입시켰다. 그 트랜잭션은 이미 끝났으니 다시 조회하면 있다.
      const winner = await this.socialAccounts.findUserByProviderAccount(provider, providerUserId)
      // 없다면 경합이 아니라 진짜 제약 위반이다(닉네임 길이 초과 등) — 삼키면 원인을 잃는다.
      if (winner === undefined) throw error
      return winner
    }
  }
}
