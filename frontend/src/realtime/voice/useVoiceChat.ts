import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '../RealtimeClientContext'
import { buildClientMessage, type PlayerId } from '../wsEvents'
import { loadIceServers } from './iceServers'
import { VoiceMesh } from './voiceMesh'

/**
 * 음성 채팅 한 벌 — 마이크를 켜고, 방의 다른 참가자들과 풀메시로 연결한다.
 *
 * **화면에서 직접 부르지 않는다.** 이 훅의 수명이 곧 통화의 수명이라, 화면이 부르면
 * 라우트가 바뀔 때(대기실 → 게임) 연결이 전부 닫히고 처음부터 다시 협상한다.
 * `VoiceProvider`가 라우터 위에서 한 번만 부르고, 화면은 `useVoice()`로 읽는다.
 */

/** 이 음량을 넘으면 "말하는 중"으로 본다. 숨소리·키보드 소리를 걸러내는 최소값이다. */
const SPEAKING_THRESHOLD = 0.02
/** 음량 확인 주기. 표시용이라 10Hz면 충분하다 — 프레임마다 재면 배터리만 먹는다. */
const LEVEL_POLL_MS = 100

export type VoiceStatus =
  | 'off'
  /** 브라우저 권한 창이 떠 있는 중. */
  | 'requesting'
  | 'on'
  /** 사용자가 거부했거나 OS가 막았다. 다시 시도할 수 있다. */
  | 'denied'
  /** 보안 컨텍스트(HTTPS)가 아니거나 기기에 마이크가 없다. 버튼 자체를 숨긴다. */
  | 'unsupported'

export interface VoiceChat {
  status: VoiceStatus
  /** 지금 연결된 상대들. */
  peers: PlayerId[]
  /** 지금 말하고 있는 상대들. 내 자신은 포함되지 않는다. */
  speaking: ReadonlySet<PlayerId>
  /** 내가 소리를 끈 상대들. 상대는 이 사실을 알 수 없다. */
  mutedPeers: ReadonlySet<PlayerId>
  toggle: () => void
  /** 특정 상대의 소리만 끄고 켠다. 통화 연결은 유지된다. */
  toggleMutePeer: (playerId: PlayerId) => void
}

/**
 * 마이크를 쓸 수 있는 환경인지. `navigator.mediaDevices`는 보안 컨텍스트(HTTPS·localhost)가
 * 아니면 **속성 자체가 없다** — 타입에는 항상 있는 것으로 선언돼 있어 `in`으로 확인한다.
 * http://<LAN IP>로 접속한 폰이 여기로 떨어진다.
 */
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
  // 진짜 값은 mesh가 들고 있다(재접속해도 유지돼야 하므로). 여기 상태는 렌더용 사본이다.
  const [mutedPeers, setMutedPeers] = useState<Set<PlayerId>>(new Set())

  const meshRef = useRef<VoiceMesh | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // 최신 mesh를 이벤트 구독에서 보되, 구독을 mesh 생성마다 다시 걸지 않기 위해 ref로 읽는다.
  const youRef = useRef(you)
  // 렌더 중에 ref를 쓰지 않는다 — 버려지는 렌더(동시성)에서 커밋되지 않은 값이 남는다.
  // layout effect는 페인트 전에 돌아서 이벤트·rAF가 읽는 시점에는 이미 최신이다.
  useLayoutEffect(() => {
    youRef.current = you
  })

  const stop = useCallback(() => {
    meshRef.current?.close()
    meshRef.current = null
    // 트랙을 멈추지 않으면 브라우저 탭의 마이크 표시등이 계속 켜져 있다.
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setPeers([])
    setSpeaking(new Set())
    // 통화를 끄면 mesh와 함께 사라지므로 화면 상태도 비운다 — 다음 통화에 남아 있으면
    // 껐던 기억이 없는 사람의 소리가 조용히 안 들린다.
    setMutedPeers(new Set())
  }, [])

  // 서버 메시지 구독. mesh가 없을 때(통화 꺼짐) 오는 메시지는 그냥 무시된다.
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

  // 말하는 사람 표시 — 통화 중일 때만 돈다.
  useEffect(() => {
    if (status !== 'on') return
    const timer = setInterval(() => {
      const levels = meshRef.current?.audioLevels() ?? new Map()
      const next = new Set<PlayerId>()
      for (const [id, level] of levels) {
        if (level >= SPEAKING_THRESHOLD) next.add(id)
      }
      // 같은 내용이면 setState를 건너뛴다 — 100ms마다 새 Set을 넣으면 화면이 계속 리렌더된다.
      setSpeaking((current) =>
        current.size === next.size && [...next].every((id) => current.has(id)) ? current : next,
      )
    }, LEVEL_POLL_MS)
    return () => clearInterval(timer)
  }, [status])

  // 언마운트하면 반드시 정리한다 — 마이크가 켜진 채로 남으면 사용자가 알아채기 어렵다.
  useEffect(() => stop, [stop])

  const start = useCallback(async () => {
    setStatus('requesting')
    let stream: MediaStream
    try {
      // 게임 소리와 겹치므로 에코 제거는 필수다. 자동 이득은 사람마다 목소리 크기가 달라서 켠다.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch {
      // 거부·기기 없음·보안 컨텍스트 아님이 모두 여기로 온다. 되살릴 수 있으니 denied로 둔다.
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
        } catch {
          // 소켓이 끊긴 동안의 시그널은 버린다 — 재연결 후 voice.peers가 다시 협상을 시작한다.
        }
      },
      you: youRef.current,
    })

    try {
      client.send(buildClientMessage('voice.join', {}))
    } catch {
      // 서버에 입장을 못 알렸으면 아무와도 연결되지 않는다. 마이크를 되돌려 놓는다.
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
      } catch {
        // 못 알려도 서버가 소켓 종료로 정리한다. 로컬 마이크는 아래에서 확실히 끈다.
      }
      stop()
      setStatus('off')
      return
    }
    if (status === 'requesting' || status === 'unsupported') return
    void start()
  }, [client, start, status, stop])

  return { mutedPeers, peers, speaking, status, toggle, toggleMutePeer }
}
