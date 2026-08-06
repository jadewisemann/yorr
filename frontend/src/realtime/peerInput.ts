import { useEffect, useRef } from 'react'
import { useOptionalRealtimeClient, type useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PeerInput, type PlayerId } from '@/realtime/wsEvents'

/**
 * 폰 컨트롤러 → 큰 화면 직통 입력.
 *
 * <b>서버는 이 경기를 모른다.</b> 로컬 AI 모드는 게임이 큰 화면 브라우저 안에서만 돌아서,
 * `game.ping_pong.swing` 같은 경기용 메시지를 보내면 "그런 게임 없음"으로 버려진다. 필요한
 * 것은 판정이 아니라 <b>배달</b>이다 — 방 안의 A가 B에게 아무거나 건네주는 통로.
 *
 * 서버에 그런 통로가 하나 있고 그것이 `voice.signal`이다. 이름만 음성이지 실제로는
 * `data`를 JsonNode로 흘려보내고(`VoiceSignalPayload`), 릴레이 조건도 <b>같은 방 멤버십
 * 하나뿐</b>이다(`handleVoiceSignal` → `registry.find(roomId, to)`). 음성 채널 참가도,
 * 마이크도 필요 없고 `voice.peers` 명단에 뜨지도 않는다.
 *
 * 그 사실이 호출부까지 새어나가지 않게 여기서 한 겹 덮는다. 화면은 "상대에게 입력을
 * 보낸다"만 알면 되고, 나중에 서버에 게임 무관 릴레이가 생기면 이 파일 두 함수만 바뀐다.
 */

/** 큰 화면의 playerId로 조작을 보낸다. 소켓이 끊겨 있으면 그 입력은 버린다. */
export function sendPeerInput(
  client: ReturnType<typeof useRealtimeClient>,
  to: PlayerId,
  input: PeerInput,
) {
  try {
    client.send(buildClientMessage('voice.signal', { data: { input, kind: 'input' }, to }))
  } catch {
    // 스윙 하나를 못 보낸 것뿐이다. 다시 휘두르면 된다 — 재전송 큐를 둘 만한 값이 아니다.
    // (같은 이유로 useVoiceChat의 sendSignal도 조용히 버린다.)
  }
}

/**
 * 큰 화면에서 폰이 보낸 조작을 받는다.
 *
 * 콜백을 ref로 들고 구독은 client에만 매다는 이유: 콜백이 매 렌더 새로 만들어지면 그때마다
 * 구독을 끊었다 다시 걸어, 그 틈에 도착한 입력이 사라진다.
 */
export function usePeerInput(onInput: (input: PeerInput, from: PlayerId) => void) {
  // 던지지 않는 쪽을 쓴다 — 로컬 게임 화면은 소켓 없이도 떠야 한다(연습·AI 대전은 서버가
  // 전제가 아니다). 폰을 붙이지 않은 판에서는 그냥 아무것도 구독하지 않는다.
  const client = useOptionalRealtimeClient()
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(
    () =>
      client?.onMessage((message) => {
        if (message.type !== 'voice.signaled') return
        const { data, from } = message.payload
        // 진짜 음성 시그널(SDP·ICE)도 같은 봉투로 온다 — 통화가 함께 켜져 있을 수 있다.
        if (data.kind !== 'input') return
        onInputRef.current(data.input, from)
      }),
    [client],
  )
}
