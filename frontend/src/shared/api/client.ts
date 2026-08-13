export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export interface ApiErrorPayload {
  code?: string
  message?: string
  [key: string]: unknown
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly payload?: ApiErrorPayload,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const payload = await readErrorPayload(response)
    throw new ApiError(
      response.status,
      payload?.message ?? payload?.code ?? `API request failed with status ${response.status}`,
      payload?.code,
      payload,
    )
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

async function readErrorPayload(response: Response): Promise<ApiErrorPayload | undefined> {
  const contentType = response.headers.get('Content-Type')

  try {
    if (contentType?.includes('application/json')) {
      const payload: unknown = await response.json()
      if (isApiErrorPayload(payload)) return payload
      if (typeof payload === 'string') return textErrorPayload(payload)
      return undefined
    }

    const payload = await response.text()
    return payload ? textErrorPayload(payload) : undefined
  } catch {
    return undefined
  }
}

function textErrorPayload(message: string): ApiErrorPayload {
  const code =
    {
      game_started: 'GAME_ALREADY_STARTED',
      invalid_nickname: 'INVALID_NICKNAME',
      room_full: 'ROOM_FULL',
      room_not_found: 'ROOM_NOT_FOUND',
    }[message] ?? message.toUpperCase()

  return { code, message }
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}
