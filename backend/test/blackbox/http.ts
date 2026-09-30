import type { Target } from './target.js'

/** REST 한 번의 결과. 오류 본문이 plain-text 코드인 계약이 많아 본문은 문자열로 둔다. */
export interface HttpResult {
  readonly status: number
  readonly text: string
  readonly contentType: string | null
  json<T>(): T
}

export interface RequestOptions {
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export const request = async (
  target: Target,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<HttpResult> => {
  const hasBody = options.body !== undefined
  const response = await fetch(`${target.httpBase}${path}`, {
    method,
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...options.headers },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  return {
    status: response.status,
    text,
    contentType: response.headers.get('content-type'),
    json: <T>() => JSON.parse(text) as T,
  }
}

/** `POST /rooms`가 돌려주는 게스트 세션 + 방. 필드 이름은 계약대로 snake_case를 옮긴다. */
export interface Entrant {
  readonly id: string
  readonly nickname: string
  readonly token: string
  readonly roomId: string
}

interface RoomEntryResponse {
  readonly id: string
  readonly nickname: string
  readonly token: string
  readonly room_id: string
}

export const enterRoomRaw = (
  target: Target,
  body: Readonly<Record<string, unknown>>,
  gameCode = 'YACHT_DICE',
): Promise<HttpResult> =>
  request(target, 'POST', `/api/v1/rooms?game_code=${encodeURIComponent(gameCode)}`, { body })

/** 방을 만들거나(`roomId` 없음) 그 방에 들어간다. 실패하면 상태와 본문을 담아 던진다. */
export const enterRoom = async (
  target: Target,
  nickname: string,
  roomId?: string,
  gameCode = 'YACHT_DICE',
): Promise<Entrant> => {
  const result = await enterRoomRaw(
    target,
    roomId === undefined ? { nickname } : { nickname, room_id: roomId },
    gameCode,
  )
  if (result.status !== 200) {
    throw new Error(`방 입장 실패: ${result.status} ${result.text}`)
  }
  const entry = result.json<RoomEntryResponse>()
  return { id: entry.id, nickname: entry.nickname, token: entry.token, roomId: entry.room_id }
}

export const authHeaders = (entrant: Entrant): Record<string, string> => ({
  'x-user-id': entrant.id,
  authorization: `Bearer ${entrant.token}`,
})

/** `POST /rooms/{code}/games`. 소켓이 붙은 **뒤에** 부른다(오프라인 턴 주인은 자동 퇴장된다). */
export const startGame = async (target: Target, host: Entrant): Promise<string> => {
  const result = await request(target, 'POST', `/api/v1/rooms/${host.roomId}/games`, {
    headers: authHeaders(host),
  })
  if (result.status !== 200) throw new Error(`게임 시작 실패: ${result.status} ${result.text}`)
  return result.json<{ gameId: string }>().gameId
}

/** 스무 자 제한 안에서 겹치지 않는 닉네임. 방마다 새 코드이므로 충돌은 가독성 문제일 뿐이다. */
export const nicknameFor = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 20)
