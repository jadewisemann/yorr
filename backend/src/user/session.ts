import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Redis } from 'ioredis'
import { InvalidNicknameError, SessionAuthenticationError } from './errors.js'

export type UserType = 'GUEST' | 'MEMBER'

export interface UserIdentity {
  readonly userId: string
  readonly nickname: string
  readonly type: UserType
}

export interface GuestSession {
  readonly userId: string
  readonly nickname: string
  readonly sessionToken: string
}

/** 게스트는 한 판을 위해 만들어진다. */
const GUEST_TTL_SECONDS = 24 * 60 * 60
/**
 * 회원 세션 수명. 게스트보다 길게 준다 — 다시 찾아오는 사용자에게 매번 카카오
 * 동의 화면을 거치게 하면 로그인한 이유가 없어진다. 활동할 때마다 갱신되므로
 * 실제로는 "30일 동안 접속이 없으면 풀린다"는 뜻이다.
 */
const MEMBER_TTL_SECONDS = 30 * 24 * 60 * 60

const NICKNAME_MAX_LENGTH = 20

const userKey = (userId: string): string => `user:${userId}`

/** 원문 토큰은 어디에도 저장하지 않는다 — 해시만 저장하고 해시로 찾는다. */
const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('base64')

const tokenKey = (token: string): string => `user:token:${hash(token)}`

const newSessionToken = (): string => randomBytes(32).toString('base64url')

const equalsConstantTime = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

const ttlOfType = (type: UserType): number =>
  type === 'MEMBER' ? MEMBER_TTL_SECONDS : GUEST_TTL_SECONDS

const parseUserType = (value: unknown): UserType | undefined =>
  value === 'GUEST' || value === 'MEMBER' ? value : undefined

/** 방 입장처럼 게스트를 만들지 않는 경로도 같은 규칙으로 이름을 다듬는다. */
export const normalizeNickname = (nickname: string | null | undefined): string => {
  const value = (nickname ?? '').trim()
  if (value.length === 0 || value.length > NICKNAME_MAX_LENGTH) throw new InvalidNicknameError()
  return value
}

const bearerToken = (authorization: string | null | undefined): string => {
  if (!authorization?.startsWith('Bearer ') || authorization.length === 7) {
    throw new SessionAuthenticationError()
  }
  return authorization.slice(7)
}

/**
 * 세션 스토어. 게스트와 회원이 **같은 자리(`user:{id}` 해시)에 같은 모양으로**
 * 들어가므로 방·게임 코드는 사용자 종류를 몰라도 된다
 * (docs/design/rooms-and-sessions.md 「세션 모델」).
 *
 * 세션 수명은 두 키(`user:{id}` 해시 · `user:token:{hash}` 역인덱스)의 합이라
 * 둘을 항상 함께 움직인다.
 */
export class UserService {
  constructor(private readonly redis: Redis) {}

  async createGuest(nickname: string | null | undefined): Promise<GuestSession> {
    const displayName = normalizeNickname(nickname)
    const userId = randomUUID()
    const sessionToken = newSessionToken()
    const key = userKey(userId)
    await this.redis.hset(key, {
      type: 'GUEST' satisfies UserType,
      nickname: displayName,
      tokenHash: hash(sessionToken),
    })
    await this.redis.expire(key, GUEST_TTL_SECONDS)
    await this.redis.set(tokenKey(sessionToken), userId, 'EX', GUEST_TTL_SECONDS)
    return { userId, nickname: displayName, sessionToken }
  }

  /**
   * 소셜 로그인으로 확인된 회원의 세션을 연다. 게스트와 같은 형태로 쓰므로
   * REST·WebSocket 인증 경로가 그대로 통과시킨다.
   *
   * 재로그인은 `tokenHash`를 덮어쓴다 → **계정당 라이브 세션은 항상 1개**.
   */
  async openMemberSession(userId: string, nickname: string): Promise<string> {
    const sessionToken = newSessionToken()
    const key = userKey(userId)
    await this.redis.hset(key, {
      type: 'MEMBER' satisfies UserType,
      nickname,
      tokenHash: hash(sessionToken),
    })
    await this.redis.expire(key, MEMBER_TTL_SECONDS)
    await this.redis.set(tokenKey(sessionToken), userId, 'EX', MEMBER_TTL_SECONDS)
    return sessionToken
  }

  async assignRoom(
    userId: string,
    roomId: string,
    roomCode: string,
    hostId: string,
  ): Promise<void> {
    const key = userKey(userId)
    await this.redis.hset(key, { roomId, roomCode, host: hostId })
    // 회원 세션을 게스트 수명으로 깎지 않는다 — 방에 들어갔다는 이유로 로그인이
    // 24시간짜리가 되면 안 된다.
    await this.redis.expire(key, await this.ttlOf(userId))
  }

  async clearRoom(userId: string): Promise<void> {
    await this.redis.hdel(userKey(userId), 'roomId', 'roomCode', 'host')
    await this.redis.del(`quick-match:user:${userId}`)
  }

  /** REST 경로: `X-User-Id` + `Authorization: Bearer <token>`. */
  async authenticate(
    userId: string | null | undefined,
    authorization: string | null | undefined,
  ): Promise<UserIdentity> {
    return this.authenticateCredentials(userId, bearerToken(authorization))
  }

  /** WebSocket·프로필·auth 경로: 토큰만 → 역인덱스로 userId를 유도한다. */
  async authenticateSession(sessionToken: string | null | undefined): Promise<UserIdentity> {
    if (!sessionToken || sessionToken.trim().length === 0) throw new SessionAuthenticationError()
    const userId = await this.redis.get(tokenKey(sessionToken))
    if (userId === null) throw new SessionAuthenticationError()
    return this.authenticateCredentials(userId, sessionToken)
  }

  /**
   * 세션을 서버에서 닫는다. 역인덱스와 함께 `tokenHash`까지 지운다 — 인덱스만
   * 지우면 WebSocket 경로는 막히지만 `userId + Bearer`를 쓰는 REST 경로는 그대로
   * 통과한다(테스트로 고정된 계약).
   *
   * 이미 없는 세션을 닫아도 조용히 성공한다.
   */
  async closeSession(sessionToken: string | null | undefined): Promise<void> {
    if (!sessionToken || sessionToken.trim().length === 0) return
    const userId = await this.redis.get(tokenKey(sessionToken))
    await this.redis.del(tokenKey(sessionToken))
    if (userId !== null) await this.redis.hdel(userKey(userId), 'tokenHash')
  }

  /**
   * 열려 있는 세션의 표시 이름을 바꾼다.
   *
   * 회원 닉네임은 **두 곳**에 있다 — 영구 저장은 users 테이블, 인증·표시는 Redis
   * 세션. DB만 고치면 다시 로그인하기 전까지 방 명단에 옛 이름이 남는다.
   */
  async renameSession(userId: string, nickname: string): Promise<void> {
    const key = userKey(userId)
    if ((await this.redis.exists(key)) === 0) return
    await this.redis.hset(key, { nickname })
  }

  private async authenticateCredentials(
    userId: string | null | undefined,
    token: string,
  ): Promise<UserIdentity> {
    if (!userId || userId.trim().length === 0) throw new SessionAuthenticationError()
    const user = await this.redis.hgetall(userKey(userId))
    const storedHash = user.tokenHash
    const nickname = user.nickname
    const type = parseUserType(user.type)
    if (
      storedHash === undefined ||
      nickname === undefined ||
      type === undefined ||
      !equalsConstantTime(hash(token), storedHash)
    ) {
      throw new SessionAuthenticationError()
    }
    // 인증에 성공할 때마다 두 키의 수명을 함께 민다(sliding).
    const ttl = ttlOfType(type)
    await this.redis.expire(userKey(userId), ttl)
    await this.redis.expire(tokenKey(token), ttl)
    return { userId, nickname, type }
  }

  /** 저장된 타입으로 수명을 고른다. 읽을 수 없으면 짧은 쪽(게스트)으로 본다. */
  private async ttlOf(userId: string): Promise<number> {
    const type = parseUserType(await this.redis.hget(userKey(userId), 'type'))
    return type === undefined ? GUEST_TTL_SECONDS : ttlOfType(type)
  }
}

export const SESSION_TTL_SECONDS = {
  guest: GUEST_TTL_SECONDS,
  member: MEMBER_TTL_SECONDS,
} as const
