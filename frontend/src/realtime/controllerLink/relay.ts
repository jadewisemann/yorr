import type { ClientMessage, PlayerId, RoomId, ServerMessage } from '@/realtime/wsEvents'

/**
 * 컨트롤러 링크가 실어 나를 수 있는 클라이언트 메시지 — **서버가 판정하지 않고 그대로
 * 중계만 하는 연출 릴레이**뿐이다.
 *
 * 두 이벤트는 원래 관전 화면의 인과를 맞추려고 들어왔다(realtime.md 「관전 연출 이벤트의
 * 유래」): `shaken`이 없으면 관전 화면이 자기 애니메이션으로 계속 흔들리고, `thrown`이
 * 없으면 굴린 사람이 아직 흔드는 중에 결과가 먼저 보인다. 즉 **얼마나 빨리 도착하는지가
 * 곧 품질인 이벤트**라서 링크로 옮길 값이 가장 크다.
 *
 * `game.ping_pong.swing`은 성격이 다르다. **파티 모드에서는 서버가 탁구를 판정하지 않고
 * 대시보드가 판정하므로**(ADR-0003), 스윙이 가야 할 곳이 서버가 아니라 큰 화면이다.
 * 링크가 없으면 서버가 받아 `game.ping_pong.swung`으로 대시보드에 전달하므로, 두 경로가
 * 같은 봉투로 수렴한다 — 받는 쪽은 어느 길로 왔는지 모른다.
 *
 * 나머지 컨트롤러 메시지가 여기 없는 이유는 하나다 — 서버가 판정·저장하고, 서버는
 * WebSocket만 말한다. 자세한 판정표는 `docs/llmwiki/controller-link.md`.
 */
export const RELAYABLE_TYPES = [
  'game.yacht_dice.dice.shake',
  'game.yacht_dice.dice.throw',
  'game.ping_pong.swing',
] as const

export type RelayableType = (typeof RELAYABLE_TYPES)[number]

export type RelayableClientMessage = Extract<ClientMessage, { type: RelayableType }>

export function isRelayable(message: ClientMessage): message is RelayableClientMessage {
  return (RELAYABLE_TYPES as readonly string[]).includes(message.type)
}

/**
 * DataChannel 위의 프레임. 서버 와이어 계약이 아니라 **두 피어 사이의 계약**이라
 * `wsEvents.ts`에 두지 않는다.
 *
 * `ping`/`pong`은 링크가 실제로 더 빠른지 재기 위한 것이다 — 링크를 붙여 두고 지연을
 * 못 재면 이 변경이 목적을 달성했는지 확인할 방법이 없다.
 */
export type ControllerLinkFrame =
  | { kind: 'relay'; message: RelayableClientMessage }
  | { kind: 'ping'; sentAt: number }
  | { kind: 'pong'; sentAt: number }

/**
 * 받은 프레임을 파싱한다. 상대는 같은 코드를 돌리는 브라우저지만, 낡은 배포본이
 * 붙어 있을 수 있으므로 모르는 모양은 **조용히 버린다** — 링크에서 던지면 채널이
 * 닫히고 폴백 판정이 늦어진다.
 */
export function parseFrame(raw: unknown): ControllerLinkFrame | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const frame = parsed as Partial<ControllerLinkFrame>

  if (frame.kind === 'ping' || frame.kind === 'pong') {
    return typeof (frame as { sentAt?: unknown }).sentAt === 'number'
      ? { kind: frame.kind, sentAt: (frame as { sentAt: number }).sentAt }
      : null
  }
  if (frame.kind !== 'relay') return null

  const message = (frame as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const candidate = message as ClientMessage
  return isRelayable(candidate) ? { kind: 'relay', message: candidate } : null
}

/**
 * 컨트롤러가 보낸 릴레이 프레임을 **서버가 뿌렸을 봉투와 같은 모양**으로 바꾼다.
 * 서버의 릴레이 절(backend `game/yacht/`의 dice 릴레이)이 하는 일과 같다 —
 * `playerId`를 채우고 이름을 과거형(`shake` → `shaken`)으로 바꾼다.
 *
 * `from`은 서버가 `voice.signaled.from`에 찍어 준 값에서 온다. 프레임 안의 주장을 쓰지
 * 않는 것이 음성 시그널링과 같은 규칙이다 — 그러면 남을 사칭할 수 있다.
 *
 * `ts`는 **받은 시각**이다. 서버 시계를 흉내내지 않는다 — 이 봉투를 만드는 시점에
 * 서버는 관여하지 않았고, 소비자도 `ts`를 읽지 않는다.
 */
export function relayedServerMessage(
  frame: Extract<ControllerLinkFrame, { kind: 'relay' }>,
  from: PlayerId,
  roomId: RoomId,
): ServerMessage {
  const { message } = frame
  if (message.type === 'game.yacht_dice.dice.shake') {
    return {
      type: 'game.yacht_dice.dice.shaken',
      ts: Date.now(),
      roomId,
      payload: { ...message.payload, playerId: from },
    }
  }
  if (message.type === 'game.ping_pong.swing') {
    // 서버가 폴백으로 뿌리는 `swung`과 **같은 봉투**를 만든다. 대시보드의 입력 경로가
    // 하나로 모이는 것이 이 변환의 목적이다.
    return {
      type: 'game.ping_pong.swung',
      ts: Date.now(),
      roomId,
      payload: { ...message.payload, playerId: from },
    }
  }
  return {
    type: 'game.yacht_dice.dice.thrown',
    ts: Date.now(),
    roomId,
    payload: { ...message.payload, playerId: from },
  }
}
