import type { Page } from '@playwright/test'
import type { Identity, RoomSnapshot } from './contract'
import { GAME_ID, HOST, ROOM_CODE } from './contract'

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
      } catch {}
    },
    [ROOM_SESSION_KEY, JSON.stringify(stored)] as const,
  )
}

export function readRoomSession(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), ROOM_SESSION_KEY)
}
