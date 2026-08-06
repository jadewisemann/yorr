import {
  EmptyNotice,
  EntryRow,
  ScrollingTrack,
  TickerLabel,
  TickerViewport,
} from '@/landing/components/RankingTicker/parts'
import { MIN_SCROLL_ENTRIES } from '@/landing/components/RankingTicker/shared'
import { WideBand } from '@/landing/components/RankingTicker/WideBand'
import { useMyWeeklyRank, useWeeklyRanking } from '@/shared/api/useRankingApi'
import { cn } from '@/shared/cn'
import { useAppStore } from '@/store'

/** 띠에 세워 두는 인원. 나머지는 드롭다운(wide)이 받는다. */
const BAND_COUNT = 5

/**
 * 랜딩 최상단에 얹히는 주간 랭킹 띠.
 * <p>
 * <b>레이아웃마다 다른 것을 한다.</b>
 * <ul>
 *   <li><b>narrow</b> — 증권 시세표처럼 옆으로 흐른다. 좁은 폭에 순위를 여러 개 세울 자리가
 *       없고, 손가락으로 펼치는 동작 하나를 아끼는 편이 낫다.
 *   <li><b>wide</b> — 흐르지 않는다. 데스크톱에서는 움직이는 글자를 눈으로 따라가는 것이
 *       읽는 게 아니라 기다리는 일이 된다. 상위 몇 명을 세워 두고, 전체는 드롭다운으로 펼친다.
 * </ul>
 * <p>
 * 흐르는 쪽은 <b>CSS keyframes</b>다 — 이 띠 아래에서 3D 히어로가 rapier 스텝을 돌리므로
 * 끝없이 도는 것에 JS 프레임을 쓰면 같은 프레임을 다툰다. 반대로 드롭다운의 펼침·접힘은
 * 언마운트를 붙잡아야 하므로 <b>motion</b>이 맡는다(design-system.md의 모션 경계).
 * <p>
 * 실패하면 <b>아무것도 그리지 않는다.</b> 랭킹은 부가 정보라, 못 읽었다는 사실을 랜딩 최상단에
 * 얹어 알릴 만한 일이 아니다.
 */
export function RankingTicker({ layout }: { layout: 'narrow' | 'wide' }) {
  const { data, isError } = useWeeklyRanking()
  const authSession = useAppStore((state) => state.authSession)
  // 로그인하지 않았으면 묻지 않는다. 게스트에게 "내 순위"는 존재하지 않는 개념이다.
  const { data: myRank } = useMyWeeklyRank(authSession?.sessionToken ?? null)

  if (isError) return null

  const entries = data?.entries ?? []
  const band = entries.slice(0, BAND_COUNT)

  return (
    <section
      aria-label="이번 주 요트랭킹"
      className={cn(
        // 배경은 landing-panel(86% 불투명)이다. landing-well은 배경 바탕(#08090a)을 같은 색
        // 55%로 얹은 값이라 랜딩 위에서 아예 분리되지 않는다 — 띠가 있는 줄도 모른다.
        'relative flex-none bg-landing-panel',
        // 짧은 가로 화면(932×430 등)에서는 접는다. 랜딩은 h-svh + overflow-hidden이라 크롬이
        // 한 층 늘면 아래 내용이 잘려 접근 불가가 된다 — 그 높이에서는 히어로가 우선이다.
        '[@media(max-height:480px)]:hidden',
      )}
    >
      {layout === 'wide' ? (
        // 헤더와 같은 이중 래퍼다 — 안쪽 69.4%에 맞춰야 워드마크 왼쪽 끝과 랭킹 라벨 왼쪽
        // 끝이 같은 세로선에 선다. 띠 전체 폭에 걸치면 헤더에 얹힌 게 아니라 떠 보인다.
        <div className="mx-auto flex h-11 w-full max-w-landing justify-center">
          <WideBand
            band={band}
            entries={entries}
            loading={!data}
            myNickname={authSession?.nickname ?? null}
            myRank={myRank ?? null}
            myUserId={authSession?.userId ?? null}
          />
        </div>
      ) : (
        <div className="flex h-11 items-center gap-3 px-5">
          <TickerLabel />
          <TickerViewport>
            {band.length === 0 ? (
              <EmptyNotice loading={!data} />
            ) : band.length >= MIN_SCROLL_ENTRIES ? (
              <ScrollingTrack entries={band} myUserId={authSession?.userId ?? null} />
            ) : (
              <EntryRow entries={band} myUserId={authSession?.userId ?? null} />
            )}
          </TickerViewport>
        </div>
      )}

      {/* 히어로 카드 하단과 같은 액센트 선(--ds-landing-accent-line)이다. 같은 형태를 다시
          쓰면 띠가 랜딩에 원래 있던 층으로 읽히고, 헤더와의 경계도 hairline보다 분명해진다. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] [background:var(--ds-landing-accent-line)]"
      />
    </section>
  )
}
