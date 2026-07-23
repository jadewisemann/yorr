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
})
