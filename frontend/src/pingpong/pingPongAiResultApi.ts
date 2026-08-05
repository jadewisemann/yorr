import { apiRequest } from '@/shared/api/client'

export interface PingPongAiResultRequest {
  resultId: string
  humanScore: number
  aiScore: number
}

export function savePingPongAiResult(
  sessionToken: string | null,
  result: PingPongAiResultRequest,
): Promise<void> {
  return apiRequest<void>('/games/ping-pong/ai-results', {
    method: 'POST',
    ...(sessionToken ? { headers: { Authorization: `Bearer ${sessionToken}` } } : {}),
    body: JSON.stringify(result),
  })
}
