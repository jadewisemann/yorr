import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { RoomBroadcaster } from './broadcaster.js'
import { envelope } from './envelope.js'
import { CHAT_TEXT_MAX_LENGTH } from './protocol.js'
import type { RoomMember } from './registry.js'

/**
 * 텍스트 채팅(chat.*) 중계 — 예전 `voice.*` 시그널링 릴레이가 있던 자리다
 * (docs/design/chat.md).
 *
 * 서버가 하는 일은 하나뿐이다: `chat.send` 한 줄을 다듬고 검사해서 방 전원에게
 * `chat.message`로 방송한다. **저장하지 않는다** — 방이 게임 한 판만 사는 수명이라
 * 이력을 두면 방 TTL·재접속 스냅샷·정원 계산이 모두 늘어나는데, 늦게 들어온 사람에게
 * 지난 대화를 보여 주는 값이 그 비용을 넘지 않는다.
 *
 * 보낸 사람(`playerId`·`nickname`)은 **레지스트리에서 꺼낸다.** 클라이언트가 실어 보낸
 * 값을 그대로 쓰면 남을 사칭할 수 있다.
 */
export const chatSendPayloadSchema = z.object({
  text: z.string().nullish(),
})

/**
 * 한 소켓이 창(`CHAT_RATE_WINDOW_MS`) 안에 보낼 수 있는 줄 수. 리액션과 달리 채팅은 글자가
 * 화면에 쌓여서, 한도가 없으면 한 명이 대화를 덮어 버린다. 6인 방에서 사람이 실제로 치는
 * 속도(빠른 대화가 초당 한 줄 남짓)보다 넉넉하게 잡아 정상 대화는 걸리지 않는다.
 */
export const CHAT_RATE_LIMIT = 10
export const CHAT_RATE_WINDOW_MS = 10_000

export type ChatRejection = 'empty' | 'too_long' | 'rate_limited'

export interface ChatChannelDependencies {
  readonly broadcaster: RoomBroadcaster
  /** 시임 — 테스트가 한도 창을 결정적으로 굴린다. */
  readonly now?: () => number
}

export class ChatChannel {
  /** playerId → 창 안에서 보낸 시각들. 창을 벗어난 값은 판정할 때 흘려 보낸다. */
  private readonly recent = new Map<string, number[]>()

  constructor(private readonly deps: ChatChannelDependencies) {}

  /**
   * `chat.send` → 방 전원에게 `chat.message`. 거절 사유를 돌려주고(호출부가 `error`
   * 봉투로 바꾼다), 통과하면 `null`이다.
   *
   * 자기 말도 방송으로 받는다 — 보낸 쪽이 화면에 먼저 그리고 서버 방송을 무시하는 구조는
   * 두 벌의 목록을 만든다. 서버가 정한 `messageId`·`at`으로 모두가 같은 줄을 본다.
   */
  send(me: RoomMember, rawText: unknown): ChatRejection | null {
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (text.length === 0) return 'empty'
    // 자르지 않고 거절한다 — 잘린 말이 나가면 보낸 사람은 자기가 무엇을 보냈는지 모른다.
    if (text.length > CHAT_TEXT_MAX_LENGTH) return 'too_long'
    if (this.exceedsRate(me.playerId)) return 'rate_limited'

    this.deps.broadcaster.broadcast(
      me.roomId,
      envelope(
        'chat.message',
        {
          messageId: randomUUID(),
          playerId: me.playerId,
          nickname: me.nickname,
          text,
          at: this.clock(),
        },
        { roomId: me.roomId },
      ),
    )
    return null
  }

  /** 소켓이 끊기거나 방을 떠날 때 한도 기록을 버린다 — 안 지우면 맵이 영구히 자란다. */
  forget(playerId: string): void {
    this.recent.delete(playerId)
  }

  private exceedsRate(playerId: string): boolean {
    const now = this.clock()
    const kept = (this.recent.get(playerId) ?? []).filter((at) => now - at < CHAT_RATE_WINDOW_MS)
    if (kept.length >= CHAT_RATE_LIMIT) {
      // 거절한 시도는 기록하지 않는다 — 세면 도배하는 쪽이 창을 계속 밀어 영구히 막힌다.
      this.recent.set(playerId, kept)
      return true
    }
    kept.push(now)
    this.recent.set(playerId, kept)
    return false
  }

  private clock(): number {
    return (this.deps.now ?? Date.now)()
  }
}
