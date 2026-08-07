import { useEffect, useRef } from 'react'
import { useOptionalRealtimeClient, type useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PeerInput, type PlayerId } from '@/realtime/wsEvents'

export function sendPeerInput(
  client: ReturnType<typeof useRealtimeClient>,
  to: PlayerId,
  input: PeerInput,
) {
  try {
    client.send(buildClientMessage('voice.signal', { data: { input, kind: 'input' }, to }))
  } catch {}
}

export function usePeerInput(onInput: (input: PeerInput, from: PlayerId) => void) {
  const client = useOptionalRealtimeClient()
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(
    () =>
      client?.onMessage((message) => {
        if (message.type !== 'voice.signaled') return
        const { data, from } = message.payload
        if (data.kind !== 'input') return
        onInputRef.current(data.input, from)
      }),
    [client],
  )
}
