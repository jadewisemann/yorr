import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type Player, type PlayerId } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { CONTROLLER_ICE_SERVERS, ControllerLink, type ControllerLinkRole } from './controllerLink'
import { type RelayableClientMessage, relayedServerMessage } from './relay'

export type ControllerLinkStatus = 'off' | 'connecting' | 'open'

export interface ControllerLinkChannel {
  status: ControllerLinkStatus
  /**
   * 마지막으로 측정된 왕복 시간(ms). 링크가 없거나 아직 못 쟀으면 null.
   *
   * **값이 아니라 함수다.** RTT는 2초마다 새로 측정되는데, 그것을 컨텍스트 값에 담으면
   * 게임 중 2초마다 이 객체의 신원이 바뀌어 `useRollBroadcast`의 콜백이 새로 만들어지고,
   * 그 콜백에 매달린 effect(메시지 구독 등)가 함께 재실행된다. 화면에 그리지 않는 관측값이
   * 게임 중 리렌더를 만들 이유가 없다.
   */
  rttMs: () => number | null
  /**
   * 연출 릴레이를 링크로 보낸다. **보내지 못하면 false** — 호출부가 그 자리에서
   * WebSocket으로 폴백한다. 폴백을 여기서 대신 해 주지 않는 이유는
   * [controller-link.md](../../../docs/llmwiki/controller-link.md)에 있다.
   */
  trySend: (message: RelayableClientMessage) => boolean
}

/**
 * provider 밖에서도 던지지 않고 "링크 없음"으로 강등한다 — 링크가 없으면 컨트롤러 입력이
 * WebSocket으로 가고 게임은 그대로 돌아간다. `useVoice`와 같은 판단이고,
 * `useRealtimeClient`가 던지는 것과는 심각도가 다르다.
 */
const NO_LINK: ControllerLinkChannel = {
  status: 'off',
  rttMs: () => null,
  trySend: () => false,
}

const ControllerLinkContext = createContext<ControllerLinkChannel>(NO_LINK)

/**
 * 대시보드가 협상할 상대. 봇은 소켓이 없어 상대가 못 되고, 대시보드 자신은 서버가 명단에
 * 넣지 않지만 방어로 함께 뺀다.
 */
function dashboardRoster(players: readonly Player[], you: PlayerId): PlayerId[] {
  return players
    .filter((player) => player.kind !== 'BOT' && player.playerId !== you)
    .map((player) => player.playerId)
}

interface ControllerLinkProviderProps {
  children: ReactNode
  /**
   * 이 기기가 링크에서 맡을 역할. `null`이면 링크를 아예 만들지 않는다 —
   * 파티 방이 아니면 직결할 큰 화면이 없다. 판정은 `room/`이 하고
   * (`useControllerLinkRole`) 여기로 내려온다: `realtime/`은 방 종류를 모른다.
   *
   * 이름이 `role`이 아닌 이유는 JSX에서 ARIA `role` 속성과 구별되지 않기 때문이다.
   */
  linkRole: ControllerLinkRole | null
}

/**
 * 컨트롤러 링크의 수명·시그널링을 배선한다. `VoiceProvider`와 같은 이유로 **라우터 위**에
 * 둔다 — 화면마다 훅을 부르면 로비→게임 전환에서 연결이 닫히고 처음부터 재협상한다.
 */
export function ControllerLinkProvider({ children, linkRole }: ControllerLinkProviderProps) {
  const client = useRealtimeClient()
  const you = useAppStore((state) => state.roomSession?.you)
  const roomId = useAppStore((state) => state.roomSession?.roomId)
  const players = useAppStore((state) => state.roomSnapshot?.players)
  const snapshotRoomId = useAppStore((state) => state.roomSnapshot?.roomId)

  const linkRef = useRef<ControllerLink | null>(null)
  const [status, setStatus] = useState<ControllerLinkStatus>('off')

  /**
   * 컨텍스트 값은 **status가 바뀔 때만** 새로 만든다. 두 함수는 `linkRef`를 읽으므로
   * 링크가 새로 만들어져도 신원이 그대로다 — 소비자의 콜백·effect가 링크 사정으로
   * 재생성되지 않는다.
   */
  const trySend = useCallback(
    (message: RelayableClientMessage) => linkRef.current?.send(message) ?? false,
    [],
  )
  const rttMs = useCallback(() => linkRef.current?.rttMs() ?? null, [])
  const channel = useMemo<ControllerLinkChannel>(
    () => (status === 'off' ? NO_LINK : { status, rttMs, trySend }),
    [rttMs, status, trySend],
  )

  useEffect(() => {
    if (!linkRole || !you || !roomId) {
      setStatus('off')
      return
    }

    let active = true
    const publish = () => {
      const link = linkRef.current
      if (!active || !link) return
      setStatus(link.openPeerIds().length > 0 ? 'open' : 'connecting')
    }

    // ICE 설정이 상수라 링크를 **그 자리에서** 만든다. 발급 REST를 기다리던 예전 배선은
    // 응답이 안 오는 망에서 링크가 영영 안 만들어졌다(controller-link.md).
    const link = new ControllerLink({
      role: linkRole,
      iceServers: CONTROLLER_ICE_SERVERS,
      sendSignal: (to, signal) => {
        try {
          client.send(buildClientMessage('ctrl.signal', { to, data: signal }))
        } catch {}
      },
      onFrame: (from, frame) => {
        if (frame.kind !== 'relay' || frame.message.roomId !== roomId) return
        // 서버가 뿌렸을 봉투와 같은 모양으로 바꿔 같은 팬아웃에 흘린다 —
        // 소비자는 어느 전송을 타고 왔는지 모른다.
        client.deliverLocal(relayedServerMessage(frame, from, roomId))
      },
      onChanged: publish,
    })
    linkRef.current = link
    publish()
    // 명단이 이미 도착해 있을 수 있다. 아래 명단 effect는 이 effect보다 먼저 돌 수 없으므로
    // 여기서 현재 값으로 한 번 맞춘다.
    const snapshot = useAppStore.getState().roomSnapshot
    if (snapshot?.roomId === roomId) link.syncPeers(dashboardRoster(snapshot.players, you))

    return () => {
      active = false
      link.close()
      linkRef.current = null
      setStatus('off')
    }
  }, [client, linkRole, roomId, you])

  useEffect(
    () =>
      client.onMessage((message) => {
        if (message.type !== 'ctrl.signaled') return
        void linkRef.current?.accept(message.payload.from, message.payload.data)
      }),
    [client],
  )

  useEffect(() => {
    if (linkRole !== 'dashboard' || !you || !roomId || snapshotRoomId !== roomId) return
    linkRef.current?.syncPeers(dashboardRoster(players ?? [], you))
  }, [linkRole, players, roomId, snapshotRoomId, you])

  return <ControllerLinkContext.Provider value={channel}>{children}</ControllerLinkContext.Provider>
}

export function useControllerLink() {
  return useContext(ControllerLinkContext)
}
