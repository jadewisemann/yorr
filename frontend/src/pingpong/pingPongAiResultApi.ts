import { apiRequest } from '@/shared/api/client'

export interface PingPongAiResultRequest {
  resultId: string
  humanScore: number
  aiScore: number
}

export function savePingPongAiResult(
  sessionToken: string,
  result: PingPongAiResultRequest,
): Promise<void> {
  return apiRequest<void>('/games/ping-pong/ai-results', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(result),
  })
}
