import type { GameKey } from '@/games'
import { Button } from '@/shared/components/Button'

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

/** 방을 여는 동안, 또는 열지 못했을 때. */
export function PartyOpeningNotice({ error, onHome }: { error: Error | null; onHome: () => void }) {
  return (
    <main className="mx-auto flex h-svh w-full max-w-lg flex-col items-center justify-center gap-4 px-gutter text-center text-content">
      {error ? (
        <>
          <p className="m-0 text-base font-bold" role="alert">
            파티 방을 열지 못했어요
          </p>
          <p className="m-0 text-sm text-content-muted">{error.message}</p>
          <Button onClick={onHome} variant="secondary">
            홈으로
          </Button>
        </>
      ) : (
        <p className="m-0 text-sm text-content-muted" role="status">
          파티 방을 열고 있어요.
        </p>
      )}
    </main>
  )
}
