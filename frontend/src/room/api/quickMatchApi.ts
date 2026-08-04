/**
 * 빠른 대전(온라인 대전) REST 계약. 방을 직접 만들지 않고 서버 대기열에 서서, 서버가 짝을
 * 지어 준 방을 받는다.
 *
 * 게임마다 이 파일을 늘릴 필요는 없다 — 게임은 `game_code` 하나로만 구분된다.
 */
import type { GameCode } from '@/games'
import { apiRequest } from '@/shared/api/client'
import { type AuthenticatedApiCallOptions, authenticatedHeaders, requestSignal } from './roomApi'

export type QuickMatchStatus = 'NOT_QUEUED' | 'WAITING' | 'MATCHED' | 'PLAYING'

export interface QuickMatch {
  status: QuickMatchStatus
  roomId: string | null
  gameCode: GameCode | null
}

/**
 * 상태 조회 간격(백엔드 권장값). MATCHED를 받은 뒤에도 계속 조회해야 한다 — 이 요청이 두
 * 사용자의 WebSocket 연결을 확인하고 게임 시작까지 진행시킨다.
 */
export const QUICK_MATCH_POLL_INTERVAL_MS = 1_000

const path = '/quick-matches'

/** 대기열에 선다. 같은 사용자가 이미 대기 중이면 서버가 현재 상태를 그대로 돌려준다. */
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

/** 대기열에서 나온다. WAITING에서만 실효가 있고, 그 뒤에는 서버가 현재 상태를 돌려준다. */
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
  return value === 'YACHT_DICE' || value === 'PING_PONG' || value === 'DUEL'
}
