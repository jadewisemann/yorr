import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '../RealtimeClientContext'
import { buildClientMessage, type PlayerId } from '../wsEvents'
import { loadIceServers } from './iceServers'
import { VoiceMesh } from './voiceMesh'

const SPEAKING_THRESHOLD = 0.02
const LEVEL_POLL_MS = 100

export type VoiceStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported'

export interface VoiceChat {
  status: VoiceStatus
  peers: PlayerId[]
  speaking: ReadonlySet<PlayerId>
  mutedPeers: ReadonlySet<PlayerId>
  toggle: () => void
  toggleMutePeer: (playerId: PlayerId) => void
}

function supportsMicrophone() {
  return typeof navigator !== 'undefined' && 'mediaDevices' in navigator
}

export function useVoiceChat(you: PlayerId): VoiceChat {
  const client = useRealtimeClient()
  const [status, setStatus] = useState<VoiceStatus>(() =>
    supportsMicrophone() ? 'off' : 'unsupported',
  )
  const [peers, setPeers] = useState<PlayerId[]>([])
  const [speaking, setSpeaking] = useState<Set<PlayerId>>(new Set())
  const [mutedPeers, setMutedPeers] = useState<Set<PlayerId>>(new Set())

  const meshRef = useRef<VoiceMesh | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const youRef = useRef(you)
  useLayoutEffect(() => {
    youRef.current = you
  })

  const stop = useCallback(() => {
    meshRef.current?.close()
    meshRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setPeers([])
    setSpeaking(new Set())
    setMutedPeers(new Set())
  }, [])

  useEffect(
    () =>
      client.onMessage((message) => {
        if (message.type === 'voice.peers') {
          meshRef.current?.syncPeers(message.payload.peers)
          return
        }
        if (message.type === 'voice.signaled') {
          void meshRef.current?.accept(message.payload.from, message.payload.data)
        }
      }),
    [client],
  )

  useEffect(() => {
    if (status !== 'on') return
    const timer = setInterval(() => {
      const levels = meshRef.current?.audioLevels() ?? new Map()
      const next = new Set<PlayerId>()
      for (const [id, level] of levels) {
        if (level >= SPEAKING_THRESHOLD) next.add(id)
      }
      setSpeaking((current) =>
        current.size === next.size && [...next].every((id) => current.has(id)) ? current : next,
      )
    }, LEVEL_POLL_MS)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => stop, [stop])

  const start = useCallback(async () => {
    setStatus('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch {
      setStatus('denied')
      return
    }

    const iceServers = await loadIceServers()
    streamRef.current = stream
    meshRef.current = new VoiceMesh({
      iceServers,
      localStream: stream,
      onPeersChanged: setPeers,
      sendSignal: (to, data) => {
        try {
          client.send(buildClientMessage('voice.signal', { data, to }))
        } catch {}
      },
      you: youRef.current,
    })

    try {
      client.send(buildClientMessage('voice.join', {}))
    } catch {
      stop()
      setStatus('off')
      return
    }
    setStatus('on')
  }, [client, stop])

  const toggleMutePeer = useCallback((playerId: PlayerId) => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.setPeerMuted(playerId, !mesh.mutedPeerIds().includes(playerId))
    setMutedPeers(new Set(mesh.mutedPeerIds()))
  }, [])

  const toggle = useCallback(() => {
    if (status === 'on') {
      try {
        client.send(buildClientMessage('voice.leave', {}))
      } catch {}
      stop()
      setStatus('off')
      return
    }
    if (status === 'requesting' || status === 'unsupported') return
    void start()
  }, [client, start, status, stop])

  return { mutedPeers, peers, speaking, status, toggle, toggleMutePeer }
}
