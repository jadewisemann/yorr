import { z } from 'zod'

// 와이어 계약의 정본은 frontend/src/realtime/wsEvents.ts다.
// 서버는 봉투(envelope) 모양만 검증하고, payload 해석은 각 핸들러·게임 모듈이 맡는다.
// 프로토콜 상수·와이어 타입은 protocol.ts에 있다.

export const inboundEnvelopeSchema = z.object({
  type: z.string().min(1),
  ts: z.number(),
  payload: z.unknown(),
  roomId: z.string().optional(),
  msgId: z.string().optional(),
})

export type InboundEnvelope = z.infer<typeof inboundEnvelopeSchema>

/** roomId·msgId는 값이 없으면 **필드 자체를 생략**한다. */
export interface OutboundEnvelope {
  type: string
  ts: number
  payload: unknown
  roomId?: string | undefined
  msgId?: string | undefined
}

export const parseInbound = (raw: unknown): InboundEnvelope | null => {
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) return null
  let json: unknown
  try {
    json = JSON.parse(raw.toString())
  } catch {
    return null
  }
  const result = inboundEnvelopeSchema.safeParse(json)
  return result.success ? result.data : null
}

export const envelope = (
  type: string,
  payload: unknown,
  rest: Partial<Pick<OutboundEnvelope, 'roomId' | 'msgId'>> = {},
): OutboundEnvelope => ({ type, ts: Date.now(), payload, ...rest })
