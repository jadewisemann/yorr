const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

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
  if (!response.headers.get('Content-Type')?.includes('application/json')) return undefined

  try {
    const payload: unknown = await response.json()
    return isApiErrorPayload(payload) ? payload : undefined
  } catch {
    return undefined
  }
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}
