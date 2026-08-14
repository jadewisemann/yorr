import { describe, expect, it } from 'vitest'
import { envelope, parseInbound } from '../envelope.js'

describe('parseInbound', () => {
  it('정상 봉투를 파싱한다', () => {
    const raw = JSON.stringify({ type: 'sys.ping', ts: 1723600000000, payload: { clientTs: 1 } })
    expect(parseInbound(raw)).toEqual({
      type: 'sys.ping',
      ts: 1723600000000,
      payload: { clientTs: 1 },
    })
  })

  it('roomId·msgId가 있으면 보존한다', () => {
    const raw = JSON.stringify({
      type: 'room.join',
      ts: 1,
      payload: {},
      roomId: 'ABC123',
      msgId: 'm-1',
    })
    expect(parseInbound(raw)).toMatchObject({ roomId: 'ABC123', msgId: 'm-1' })
  })

  it('JSON이 아니면 null', () => {
    expect(parseInbound('not-json')).toBeNull()
  })

  it('type이 없으면 null', () => {
    expect(parseInbound(JSON.stringify({ ts: 1, payload: {} }))).toBeNull()
  })

  it('문자열·버퍼가 아니면 null', () => {
    expect(parseInbound(42)).toBeNull()
  })
})

describe('envelope', () => {
  it('type·payload·ts를 채운다', () => {
    const message = envelope('sys.pong', { serverTs: 2 })
    expect(message.type).toBe('sys.pong')
    expect(message.payload).toEqual({ serverTs: 2 })
    expect(typeof message.ts).toBe('number')
  })
})
