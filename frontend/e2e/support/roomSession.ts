import type { Page } from '@playwright/test'
import type { Identity, RoomSnapshot } from './contract'
import { GAME_ID, HOST, ROOM_CODE } from './contract'

/**
 * 재접속 테스트용 시딩. 저장 위치·키·봉투 모양은 src/roomSessionStorage.ts와 같아야 한다
 * (localStorage의 `yorr.room-session`, `{ session, expiresAt }` 봉투). 값이 스키마 검증을
 * 통과하지 못하면 store는 세션 없음으로 시작하고 "이어서 하기" UI 자체가 나오지 않는다.
 */

const ROOM_SESSION_KEY = 'yorr.room-session'
const ROOM_SESSION_TTL_MS = 40 * 60 * 1000

export interface StoredRoomSession {
  gameId: string | null
  roomId: string
  roomCode: string
  you: string
  nickname: string
  membershipRole: 'host' | 'participant'
  sessionToken: string
  snapshot: RoomSnapshot | null
}

export function storedSession(options: {
  identity?: Identity
  snapshot: RoomSnapshot | null
  membershipRole?: 'host' | 'participant'
  gameId?: string | null
  roomCode?: string
}): StoredRoomSession {
  const identity = options.identity ?? HOST
  const roomCode = options.roomCode ?? ROOM_CODE
  return {
    gameId: options.gameId ?? null,
    roomId: roomCode,
    roomCode,
    you: identity.id,
    nickname: identity.nickname,
    membershipRole: options.membershipRole ?? 'host',
    sessionToken: identity.token,
    snapshot: options.snapshot,
  }
}

/** 게임 중 세션이 살아 있는 상태. gameId까지 넣어 새로고침 후 REST 재조회 경로도 태운다. */
export function playingSession(snapshot: RoomSnapshot, identity: Identity = HOST) {
  return storedSession({
    identity,
    snapshot,
    gameId: GAME_ID,
    membershipRole: identity === HOST ? 'host' : 'participant',
  })
}

export async function seedRoomSession(page: Page, session: StoredRoomSession) {
  const stored = { session, expiresAt: Date.now() + ROOM_SESSION_TTL_MS }
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key as string, value as string)
      } catch {
        // 사파리 프라이빗 모드처럼 저장소가 막힌 환경. 시딩 실패는 테스트가 어서션으로 잡는다.
      }
    },
    [ROOM_SESSION_KEY, JSON.stringify(stored)] as const,
  )
}

export function readRoomSession(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), ROOM_SESSION_KEY)
}
