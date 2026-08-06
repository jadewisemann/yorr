import type { GameKey } from '@/games'
import type { Player, PlayerId } from '@/realtime/wsEvents'
import { PlayerCard } from '@/room/components/PlayerCard'

/**
 * 파티 모드 대시보드 대기 화면 — 큰 화면이 게임판이 되고, 사람들은 QR을 찍어 폰으로 붙는다.
 *
 * <b>랜딩 팔레트를 문 앞에서 버린다.</b> `--ds-landing-*` 대신 게임 화면과 같은
 * `bg-canvas`/`border-border`/`text-content`를 쓰고, 프레임(`max-w-play`,
 * `grid-cols-[minmax(0,1fr)_28rem]`)과 네 개의 띠를 {@link GamePlay}에서 그대로 가져온다.
 * 시작 순간에 팔레트나 골격이 바뀌면 "이어지는 화면"이 될 수 없기 때문이다:
 *
 * <pre>
 *   헤더(게임·방 코드)     → GamePlayHeader
 *   인원 한 줄             → TurnStrip
 *   QR 블록                → GameDiceTray
 *   방장 안내 띠            → [굴리기] · 모두 해제
 *   참가자 열(28rem·border-l) → ScoreSheet
 * </pre>
 * <p>
 * <b>조작 버튼은 두지 않는다.</b> 대시보드는 방장이 아니다 — 방장은 처음 들어온 컨트롤러이고
 * (백엔드 {@code RoomValidationService}의 JOIN 규약), 게임 시작·봇 추가는 그 폰의 대기실에서
 * 한다. TV·모니터에 마우스를 기대하지 않는 것과 같은 이유다.
 *
 * 폭 분기도 랜딩 기준(760px)이 아니라 <b>게임 화면 기준(1024px)</b>을 쓴다 — 시작 전후가
 * 같은 지점에서 같은 모양으로 꺾여야 한다.
 */

/**
 * 파티 대시보드가 받는 게임. 라우트가 `isPartyGameKey`로 걸러 주므로 여기 도달한 키는
 * 반드시 백엔드 게임 모듈(`gameCode`)을 갖고 있다 — 이 화면은 그걸 믿고 방을 연다.
 */
export type PartyGameKey = GameKey

export function ParticipantColumn({
  capacity,
  hostId,
  players,
}: {
  capacity: number
  hostId: PlayerId | undefined
  players: Player[]
}) {
  const emptySeats = Math.max(0, capacity - players.length)

  return (
    <section
      aria-label={`참가자 ${players.length}명`}
      className="flex min-h-0 flex-col border-l border-border"
    >
      <div className="flex flex-none items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
        <h2 className="m-0 text-sm font-bold tracking-[0.02em] whitespace-nowrap">참가자</h2>
        <p className="m-0 font-mono text-xs tabular-nums text-content-faint">
          {players.length} / {capacity}
        </p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min gap-2.5 overflow-y-auto px-3 pb-3">
        {players.map((player) => (
          <PlayerCard
            avatarSeed={player.playerId}
            key={player.playerId}
            name={player.nickname}
            status={player.status}
            subtitle={player.kind === 'BOT' ? '상태 기반 AI 봇' : undefined}
            // 방장 표시가 이 화면에서 정보인 이유: 시작 버튼이 이 화면에 없으므로, 누구 폰을
            // 봐야 하는지 알려주지 않으면 TV 앞 사람들이 서로를 쳐다보게 된다.
            trailing={
              player.playerId === hostId ? (
                <span className="rounded-chip bg-border px-1.5 py-0.5 font-mono text-2xs font-bold tracking-[0.1em] text-content-muted">
                  방장
                </span>
              ) : undefined
            }
          />
        ))}
        {players.length === 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-border-raised px-3 text-sm text-content-muted">
            아직 아무도 없어요 · QR을 찍어 주세요
          </p>
        )}
        {emptySeats > 0 && players.length > 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-border-raised px-3 text-sm text-content-muted tabular-nums">
            <span
              aria-hidden="true"
              className="size-11 flex-none rounded-card border border-dashed border-border-strong"
            />
            빈 자리 {emptySeats}
          </p>
        )}
      </div>
    </section>
  )
}
