import { describe, expect, it, vi } from 'vitest'
import { buildClientMessage } from '../../contracts/ws-events'
import { FakeRealtimeClient } from './FakeRealtimeClient'

describe('FakeRealtimeClient', () => {
  it('records outgoing messages and notifies connection listeners', () => {
    const client = new FakeRealtimeClient()
    const listener = vi.fn()
    client.onConnectionChange(listener)

    client.connect()
    client.send(buildClientMessage('sys.ping', { clientTs: 1 }))

    expect(listener).toHaveBeenCalledWith('open')
    expect(client.sentMessages).toHaveLength(1)
  })

  it('disconnect는 close를 알린다', () => {
    const client = new FakeRealtimeClient()
    const listener = vi.fn()
    client.onConnectionChange(listener)

    client.disconnect()

    expect(listener).toHaveBeenCalledWith('close')
  })

  it('수신 메시지를 구독자 전원에게 넘긴다', () => {
    const client = new FakeRealtimeClient()
    const first = vi.fn()
    const second = vi.fn()
    client.onMessage(first)
    client.onMessage(second)
    const message = {
      type: 'sys.pong',
      ts: 1,
      payload: { serverTs: 1 },
    } as const

    client.emitMessage(message)

    expect(first).toHaveBeenCalledWith(message)
    expect(second).toHaveBeenCalledWith(message)
  })

  it('구독 해지 함수가 리스너를 떼어낸다', () => {
    const client = new FakeRealtimeClient()
    const onMessage = vi.fn()
    const onConnection = vi.fn()
    client.onMessage(onMessage)()
    client.onConnectionChange(onConnection)()

    client.emitMessage({ type: 'sys.pong', ts: 1, payload: { serverTs: 1 } })
    client.connect()

    expect(onMessage).not.toHaveBeenCalled()
    expect(onConnection).not.toHaveBeenCalled()
  })
})
