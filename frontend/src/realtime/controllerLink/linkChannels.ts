/**
 * 컨트롤러 링크가 쓰는 **DataChannel 이름·초기화 옵션**과 작은 전송 도구.
 *
 * `controllerLink.ts`에서 갈라 둔 이유: 채널을 둘로 나눈 기준(유실돼도 되는가)은
 * 링크의 협상 절차와 무관한 프로토콜 결정이다. 값을 바꿀 때 상태 기계를 지나치지
 * 않게 하고, 문서(`docs/llmwiki/controller-link.md`)와 대조하기 쉽게 한 곳에 둔다.
 */
import type { ControllerLinkFrame, RelayableClientMessage } from './relay'

/**
 * 채널 두 개를 나눈 기준: **유실돼도 다음 것이 덮는 신호는 unreliable, 한 번뿐인 신호는
 * reliable.** 흔들림 펄스는 60ms마다 새로 오므로 늦게 도착한 옛 펄스가 오히려 해롭고,
 * 던지기는 놓치면 대시보드의 사발이 제때 쏟아지지 않는다.
 */
export const PULSE_CHANNEL = 'yorr.ctrl.pulse'
export const EVENT_CHANNEL = 'yorr.ctrl.event'

/**
 * 흔들림 펄스만 unreliable이다. 던지기와 탁구 스윙은 **한 번뿐인 신호**라 놓치면
 * 대시보드가 그 입력을 영영 모른다.
 */
export const channelFor = (type: RelayableClientMessage['type']): string =>
  type === 'game.yacht_dice.dice.shake' ? PULSE_CHANNEL : EVENT_CHANNEL

/** 흔들림 펄스: 재전송 없음 + 순서 없음. TCP의 head-of-line blocking을 피하는 자리다. */
export const PULSE_INIT: RTCDataChannelInit = { ordered: false, maxRetransmits: 0 }

/** 던지기: 재전송은 하되 순서는 강제하지 않는다 — 앞선 펄스를 기다릴 이유가 없다. */
export const EVENT_INIT: RTCDataChannelInit = { ordered: false }

export const isOpen = (channel: RTCDataChannel): boolean => channel.readyState === 'open'

export function trySend(channel: RTCDataChannel, frame: ControllerLinkFrame): void {
  try {
    channel.send(JSON.stringify(frame))
  } catch {}
}

export async function safely(action: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await action()
  } catch {}
}
