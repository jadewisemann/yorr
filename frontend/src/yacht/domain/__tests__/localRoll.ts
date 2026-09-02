import { buildClientMessage, type ServerMessage } from '@/realtime/wsEvents'

/** 서버 없이 도는 로컬 게임 클라이언트의 최소 모양. 연습·레버리지가 함께 만족한다. */
interface LocalGameClient {
  onMessage(listener: (message: ServerMessage) => void): () => void
  send(message: ReturnType<typeof buildClientMessage>): void
}

/**
 * 주사위를 한 번 굴리고 방송된 눈을 읽는다.
 *
 * 로컬 게임은 `send`가 그 자리에서 답을 되쏘므로 구독을 걸었다가 바로 걷는다 —
 * 기다릴 것이 없다.
 */
export function rollLocalDice(
  client: LocalGameClient,
  params: {
    readonly roomId: string
    readonly held: readonly [boolean, boolean, boolean, boolean, boolean]
    readonly rollCount: 1 | 2 | 3
  },
): readonly number[] | null {
  let dice: readonly number[] | null = null
  const stop = client.onMessage((message) => {
    if (message.type === 'game.yacht_dice.dice.broadcast') dice = message.payload.dice
  })
  client.send(
    buildClientMessage(
      'game.yacht_dice.dice.roll',
      { held: params.held, rollCount: params.rollCount, roundNumber: 1 },
      { roomId: params.roomId },
    ),
  )
  stop()
  return dice
}
