/**
 * 시작 명단에서 **사람만 골라 호스트를 맨 앞에** 세운다.
 *
 * 순서가 곧 턴 순서이고 호스트가 선이라는 것이 세 게임의 공통 규칙이다. 봇을 빼는
 * 이유는 게임마다 다르지 않다 — 봇을 지원하는 게임(야추)은 자기 좌석 배치를 따로
 * 갖고 있고, 여기 오는 것은 사람만 앉는 판이다.
 */
export const humanPlayersHostFirst = (roster: {
  readonly hostId: string | null
  readonly players: readonly { readonly playerId: string; readonly kind: string }[]
}): string[] => {
  const humans = roster.players.filter((player) => player.kind === 'HUMAN')
  return [
    ...humans.filter((player) => player.playerId === roster.hostId),
    ...humans.filter((player) => player.playerId !== roster.hostId),
  ].map((player) => player.playerId)
}
