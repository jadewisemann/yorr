import { describe, expect, it } from 'vitest'
import { DataIntegrityViolationError } from '../errors.js'
import type { SocialAccountRegistrar, SocialAccountRepository } from '../socialAccountStore.js'
import { SocialLoginService } from '../socialLoginService.js'
import { type MemberUser, PLACEHOLDER_NICKNAME, type SocialProvider } from '../socialProfile.js'

/**
 * backend-java `auth/application/SocialLoginServiceTest` 이식.
 *
 * MySQL 없이 돈다 — 여기서 고정하는 것은 저장소 동작이 아니라 **분기**다:
 * 로그인/가입 선택, 플레이스홀더 채택 규칙, 그리고 가입 경합에서 진 쪽이
 * 승자를 다시 찾아 돌려주는 경로.
 */

const PROVIDER_USER_ID = '1234567890'
const KAKAO: SocialProvider = 'KAKAO'

const member = (nickname: string, id = `user-${nickname}`): MemberUser => ({
  id,
  nickname,
  profileImageUrl: null,
})

/** 호출마다 다른 결과를 주는 조회 — 경합 재조회(없음 → 있음)를 흉내 낸다. */
const repository = (
  ...results: (MemberUser | undefined)[]
): SocialAccountRepository & {
  calls: number
} => {
  const queue = [...results]
  const fake = {
    calls: 0,
    findUserByProviderAccount: async (): Promise<MemberUser | undefined> => {
      fake.calls += 1
      return queue.length > 1 ? queue.shift() : queue[0]
    },
  }
  return fake
}

interface RegistrarCalls {
  registered: number
  adopted: number
}

const registrar = (
  behavior: Partial<SocialAccountRegistrar> = {},
): SocialAccountRegistrar & { calls: RegistrarCalls } => {
  const calls: RegistrarCalls = { registered: 0, adopted: 0 }
  return {
    calls,
    register: async (provider, providerUserId, nickname, profileImageUrl) => {
      calls.registered += 1
      if (behavior.register === undefined) throw new Error('register가 호출되면 안 된다')
      return behavior.register(provider, providerUserId, nickname, profileImageUrl)
    },
    adoptProviderProfile: async (userId, nickname, profileImageUrl) => {
      calls.adopted += 1
      if (behavior.adoptProviderProfile === undefined) {
        throw new Error('adoptProviderProfile이 호출되면 안 된다')
      }
      return behavior.adoptProviderProfile(userId, nickname, profileImageUrl)
    },
  }
}

describe('SocialLoginService', () => {
  it('이미 연결된 소셜 계정이면 가입하지 않고 그 회원을 돌려준다', async () => {
    const existing = member('기존회원')
    const registry = registrar()
    const service = new SocialLoginService(repository(existing), registry)

    const result = await service.loginOrRegister(KAKAO, PROVIDER_USER_ID, '카카오닉', null)

    expect(result).toBe(existing)
    expect(registry.calls.registered).toBe(0)
  })

  /**
   * 동의항목이 꺼진 채로 처음 로그인하면 "플레이어"로 가입된다. 나중에 설정을
   * 켜도 우리가 받아 적지 않으면 그 이름이 영원히 남는다 — 고칠 화면도 아직 없다.
   */
  it('임시 이름으로 가입된 회원은 진짜 이름을 받으면 갱신한다', async () => {
    const placeholder = member(PLACEHOLDER_NICKNAME, 'user-1')
    const renamed: MemberUser = {
      id: 'user-1',
      nickname: '진짜닉네임',
      profileImageUrl: 'https://img',
    }
    const registry = registrar({ adoptProviderProfile: async () => renamed })
    const service = new SocialLoginService(repository(placeholder), registry)

    const result = await service.loginOrRegister(
      KAKAO,
      PROVIDER_USER_ID,
      '진짜닉네임',
      'https://img',
    )

    expect(result).toBe(renamed)
    expect(registry.calls.adopted).toBe(1)
  })

  /** 제공자가 이번에도 이름을 주지 않았다면 채택할 것이 없다(플레이스홀더 → 플레이스홀더). */
  it('임시 이름 회원이라도 받은 이름이 플레이스홀더면 갱신하지 않는다', async () => {
    const placeholder = member(PLACEHOLDER_NICKNAME, 'user-1')
    const registry = registrar()
    const service = new SocialLoginService(repository(placeholder), registry)

    const result = await service.loginOrRegister(
      KAKAO,
      PROVIDER_USER_ID,
      PLACEHOLDER_NICKNAME,
      null,
    )

    expect(result).toBe(placeholder)
    expect(registry.calls.adopted).toBe(0)
  })

  /** 사용자가 직접 정한 이름을 로그인할 때마다 덮어쓰면 바꿀 방법이 없어진다. */
  it('이미 이름이 있는 회원은 로그인해도 덮어쓰지 않는다', async () => {
    const existing = member('내가정한이름')
    const registry = registrar()
    const service = new SocialLoginService(repository(existing), registry)

    const result = await service.loginOrRegister(KAKAO, PROVIDER_USER_ID, '카카오에서온이름', null)

    expect(result).toBe(existing)
    expect(registry.calls.adopted).toBe(0)
  })

  it('처음 보는 소셜 계정이면 가입시킨다', async () => {
    const created = member('카카오닉')
    const registry = registrar({ register: async () => created })
    const service = new SocialLoginService(repository(undefined), registry)

    const result = await service.loginOrRegister(KAKAO, PROVIDER_USER_ID, '카카오닉', 'https://img')

    expect(result).toBe(created)
    expect(registry.calls.registered).toBe(1)
  })

  /**
   * 로그인 버튼을 두 번 누르면 두 요청이 모두 "없음"을 보고 나란히 가입을 시도한다.
   * 유니크 제약이 한쪽을 막는데, 그 실패는 오류가 아니라 "누가 먼저 가입했다"는
   * 신호다 — 재조회로 승자를 돌려준다.
   */
  it('동시 가입으로 유니크 제약에 걸리면 먼저 가입된 회원을 다시 찾는다', async () => {
    const winner = member('먼저가입')
    const accounts = repository(undefined, winner)
    const registry = registrar({
      register: async () => {
        throw new DataIntegrityViolationError(
          'Duplicate entry for key uk_social_accounts_provider_user',
        )
      },
    })
    const service = new SocialLoginService(accounts, registry)

    const result = await service.loginOrRegister(KAKAO, PROVIDER_USER_ID, '카카오닉', null)

    expect(result).toBe(winner)
    expect(accounts.calls).toBe(2)
  })

  /** 제약 위반인데 다시 찾아도 없다면 경합이 아니라 진짜 오류다 — 삼키면 원인을 잃는다. */
  it('제약 위반 뒤에도 회원을 찾지 못하면 원래 예외를 그대로 던진다', async () => {
    const failure = new DataIntegrityViolationError('nickname too long')
    const registry = registrar({
      register: async () => {
        throw failure
      },
    })
    const service = new SocialLoginService(repository(undefined), registry)

    await expect(service.loginOrRegister(KAKAO, PROVIDER_USER_ID, '카카오닉', null)).rejects.toBe(
      failure,
    )
  })

  /** 제약 위반이 아닌 실패(커넥션 끊김 등)는 재조회로 덮지 않는다. */
  it('제약 위반이 아닌 오류는 그대로 전파한다', async () => {
    const failure = new Error('connection lost')
    const accounts = repository(undefined)
    const registry = registrar({
      register: async () => {
        throw failure
      },
    })

    await expect(
      new SocialLoginService(accounts, registry).loginOrRegister(
        KAKAO,
        PROVIDER_USER_ID,
        '카카오닉',
        null,
      ),
    ).rejects.toBe(failure)
    expect(accounts.calls).toBe(1)
  })
})
