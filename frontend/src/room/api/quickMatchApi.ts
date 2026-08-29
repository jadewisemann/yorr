import type { GameCode } from '@/games'
import { apiRequest } from '@/shared/api/client'
import { type AuthenticatedApiCallOptions, authenticatedHeaders, requestSignal } from './roomApi'

export type QuickMatchStatus = 'NOT_QUEUED' | 'WAITING' | 'MATCHED' | 'PLAYING'

export interface QuickMatch {
  status: QuickMatchStatus
  roomId: string | null
  gameCode: GameCode | null
}

export const QUICK_MATCH_POLL_INTERVAL_MS = 1_000

const path = '/quick-matches'

export function enterQuickMatch(gameCode: GameCode, options: AuthenticatedApiCallOptions) {
  return apiRequest<unknown>(`${path}?game_code=${gameCode}`, {
    method: 'POST',
    ...requestSignal(options),
    headers: authenticatedHeaders(options),
  }).then(toQuickMatch)
}

export function getQuickMatch(options: AuthenticatedApiCallOptions) {
  return apiRequest<unknown>(path, {
    ...requestSignal(options),
    headers: authenticatedHeaders(options),
  }).then(toQuickMatch)
}

export function cancelQuickMatch(options: AuthenticatedApiCallOptions) {
  return apiRequest<unknown>(path, {
    method: 'DELETE',
    ...requestSignal(options),
    headers: authenticatedHeaders(options),
  }).then(toQuickMatch)
}

function toQuickMatch(response: unknown): QuickMatch {
  if (
    typeof response !== 'object' ||
    response === null ||
    !isQuickMatchStatus((response as { status?: unknown }).status)
  ) {
    throw new Error('Invalid quick match response')
  }

  const { status, roomId, gameCode } = response as {
    status: QuickMatchStatus
    roomId?: unknown
    gameCode?: unknown
  }

  return {
    status,
    roomId: typeof roomId === 'string' && roomId.length > 0 ? roomId : null,
    gameCode: isGameCode(gameCode) ? gameCode : null,
  }
}

function isQuickMatchStatus(value: unknown): value is QuickMatchStatus {
  return value === 'NOT_QUEUED' || value === 'WAITING' || value === 'MATCHED' || value === 'PLAYING'
}

function isGameCode(value: unknown): value is GameCode {
  return (
    value === 'YACHT_DICE' || value === 'PING_PONG' || value === 'DUEL' || value === 'DAVINCI_CODE'
  )
}
