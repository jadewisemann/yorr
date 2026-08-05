import type { Game } from '@/games'
import { cn } from '@/shared/cn'
import { HeroCanvas } from './HeroCanvas'

interface LandingHeroCardProps {
  game: Game
  /** wide = 데스크톱 네 모서리 카드, narrow = 모바일 상하 2단 카드. */
  layout: 'narrow' | 'wide'
  /** 카드 안 플레이 CTA. 준비 중인 게임은 잠긴 버튼이 같은 자리에 서므로 호출되지 않는다. */
  onPlay: () => void
}

/**
 * 캐러셀 가운데에 서는 선택된 게임 카드. 3D 히어로가 카드 안을 채우고, 카피는
 * <b>가장자리로만</b> 흩는다 — 가운데를 비워야 3D가 산다.
 * <p>
 * wide는 네 모서리다: 제목 좌상 · 메타 필 우상 · 태그라인 좌하 · 플레이 CTA 우하.
 * 이전에는 넷이 전부 좌하단에 세로로 쌓여 카드 아래 절반을 통째로 먹었고, 그 밑을 덮는
 * 스크림(높이의 53%)이 3D 피사체의 아래 36%를 잠갔다. 모서리로 흩으면 스크림이 26%로
 * 줄고 피사체 위에 얹히는 글자가 사라진다(1440에서 최대 3px, 1920에서 0).
 * <p>
 * narrow는 축이 다르다 — 337px 폭에서는 네 모서리가 성립하지 않는다(CTA 최소 125px +
 * 메타 필 273px = 410 > 안쪽 폭 297). 그래서 위·아래로 가른다: 제목·태그라인 위,
 * 메타 필·CTA 아래. 아래에 무거운 덩어리는 CTA 하나뿐이고 필은 헤어라인 칩이다.
 */
export function LandingHeroCard({ game, layout, onPlay }: LandingHeroCardProps) {
  const wide = layout === 'wide'

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden border [background:var(--ds-landing-card)]',
        wide ? 'rounded-sheet' : 'rounded-sheet',
        game.live
          ? 'border-landing-accent/42 shadow-landing-card'
          : 'border-landing-hairline-strong shadow-landing-card-quiet',
      )}
    >
      <HeroCanvas game={game.key} />

      {/* 상단 크라운. 제목이 위로 올라오면서 새로 필요해진 층이다 — 카드 바탕은 좌상단에서
          #141517이라 흰 글자가 16.7:1로 서지만, 3D 피사체는 아이보리(1.06:1)다.
          인셋(상단 광택선)보다 <b>먼저</b> 그린다 — 뒤에 두면 88% 검정이 그 2px 흰 선을 지운다. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 [background:var(--ds-landing-card-crown)]',
          cardCrown[layout],
        )}
      />
      {/* 카드 안쪽 광택과 위에서 떨어지는 스포트라이트. 순서대로 겹쳐야 아래가 잠긴다.
          스포트라이트는 크라운 위에 남긴다 — 실측 최대 흰색 5%에 도달 범위가 카드 상단
          중앙 320×41px뿐이라, 제목이 서는 좌상단에서는 alpha가 정확히 0이다. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 [background:var(--ds-landing-card-glow)]',
          wide ? '-top-30 h-90 w-160' : '-top-17 h-55 w-75',
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-landing-card-inset"
      />
      {/* 하단 스크림. 담는 것이 CTA 한 줄과 한 줄 카피뿐이라 예전 절반 깊이면 된다. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 [background:var(--ds-landing-card-scrim)]',
          cardScrim[layout],
        )}
      />
      {game.live && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] [background:var(--ds-landing-accent-line)]"
        />
      )}

      {/* 상단 띠 — 왼쪽은 "무엇인가", 오른쪽은 "재원". 절대 배치 두 개가 아니라 한 줄의
          justify-between인 이유: 게임 이름 길이가 5~7음절로 흔들리고 필 글자 수도 게임마다
          다르다. 절대 배치로 두면 어느 폭에선가 반드시 겹치고, 겹치는 순간 제목이 필 뒤로
          들어간다. 줄로 두면 겹칠 방법이 없다.
          가로는 고정, 세로만 %로 줄인다 — 932×430처럼 납작한 카드에서 36px은 높이의 15%다. */}
      <div
        className={cn(
          'absolute flex items-start justify-between',
          cardInsetX[layout],
          bandTop[layout],
          wide ? 'gap-8' : 'gap-4',
        )}
      >
        {/* 여기 있던 PLAYABLE NOW / COMING SOON 배지는 걷었다. 아래 CTA가 같은 말을 더
            강하게 한다 — 활성화된 레드 버튼이 곧 PLAYABLE NOW이고, 잠긴 회색 버튼이
            COMING SOON이다. 상태 채널은 여전히 셋이다: 버튼 채움·라벨, 카드 테두리 색,
            하단 accent line. */}
        <div className="flex min-w-0 flex-col items-start gap-2">
          {/* 페이지 제목은 랜딩 카피가 갖는다 — 여기가 h1이면 스와이프할 때마다 문서의
              최상위 제목이 바뀐다. 이 카드는 tabpanel의 제목이라 h2가 맞다. */}
          <h2
            className={cn(
              'm-0 text-balance font-bold tracking-[-0.035em] text-landing-text',
              wide ? 'text-[clamp(40px,4.6vw,66px)]/none' : 'text-[clamp(30px,9.4vw,38px)]/[1.05]',
            )}
          >
            {game.name}
          </h2>
          {/* narrow만 제목 아래 붙는다. wide는 좌하단에서 CTA와 같은 바닥선에 선다 —
              태그라인은 명령형 보이스라 버튼과 짝이 맞고, 사실 진술(메타 필)은 위다.
              뷰포트 세로 600px 아래에서는 접는다: 카드가 281px로 줄어드는 구간이라
              태그라인이 들어오면 3D 띠가 116 → 88px로 무너지고 피사체 상단과 겹친다. */}
          {!wide && (
            <p className="m-0 text-pretty text-sm/[1.35] font-semibold text-landing-text-strong [@media(max-height:600px)]:hidden">
              {game.tagline}
            </p>
          )}
        </div>

        {/* 필은 wide에서만 이 줄에 선다. narrow는 폭이 없어 제목과 나란히 세울 수 없고
            (안쪽 297px 중 필 세 칸이 273px), 사용자가 요구한 축도 위·아래다.
            shrink-0 + max-w: 제 폭을 지키되 상한에서 접힌다 — 접히는 편이 줄어드는 편보다
            낫다. 필 안 글자는 줄바꿈이 안 된다(whitespace-nowrap). */}
        {/* flex-nowrap: 두 줄로 접히면 상단 띠가 그만큼 두꺼워지고 카드마다 높이가 달라
            보인다. 좁아지면 접는 대신 칸이 작아진다. */}
        {wide && (
          <div className="flex min-w-0 shrink-0 flex-nowrap justify-end gap-2.5">
            <LandingMetaPills game={game} layout="wide" />
          </div>
        )}
      </div>

      {/* 하단 띠. wide는 좌우로 갈리고(태그라인 ↔ CTA), narrow는 세로로 쌓인다(필 → CTA).
          "카피 묶음과 CTA가 한 줄에 서려면 카드 1150px이 필요하다"는 계산의 전제였던 세 줄
          묶음이 통째로 위로 올라갔다. 지금 CTA 옆에 서는 것은 한 줄뿐이고, 2줄로 접혀도
          CTA 높이보다 낮아 띠 높이가 늘지 않는다 — 932에서 카드 646px이어도 성립한다. */}
      <div
        className={cn(
          'absolute flex',
          cardInsetX[layout],
          bandBottom[layout],
          wide ? 'items-end justify-between gap-8' : 'flex-col items-stretch gap-2.5',
        )}
      >
        {wide ? (
          // line-clamp-2: 액션 클러스터가 버튼 두 개로 넓어져 760px에서 이 칸에 83px밖에
          // 남지 않는다. 접히는 줄 수를 묶지 않으면 하단 띠가 두꺼워지고 그만큼 3D 영역이
          // 깎인다 — 카드 높이 상한(32rem)이 CTA 한 개 시절 값이라 여유가 없다.
          <p className="m-0 line-clamp-2 min-w-0 text-pretty text-[clamp(16px,1.6vw,22px)]/[1.3] font-semibold text-landing-text-strong">
            {game.tagline}
          </p>
        ) : (
          // narrow의 필은 여기, CTA 바로 위다. 사실 진술(인원·시간·조작)이 행동 바로 앞에
          // 서고, 위쪽은 이름과 한 줄 카피만 남아 가벼워진다.
          <div className="flex min-w-0 flex-nowrap gap-1">
            <LandingMetaPills game={game} layout="narrow" />
          </div>
        )}
        {/* CTA는 플레이 하나뿐이다(S15P11A406-213) — 파티 모드·AI 대전·연습 같은 진입
            방식은 플레이를 누르면 서는 모드 선택 카드(PlayModeDialog)로 옮겼다. 카드에
            버튼이 여럿 서면 게임마다 클러스터 폭이 달라져 캐러셀이 흔들려 보였다. */}
        <div className={cn('flex flex-none', wide ? 'justify-end' : 'items-stretch')}>
          <HeroCta game={game} layout={layout} onPlay={onPlay} />
        </div>
      </div>
    </div>
  )
}

/** 카드 안쪽 액자. 네 모서리가 보이는 순간 비대칭(예전 left-11 / right-10)은 실수로 읽힌다. */
const cardInsetX = {
  narrow: 'inset-x-5',
  wide: 'inset-x-9',
} as const

/** 세로 인셋만 카드 높이를 따라간다 — 932×430에서 카드가 236px까지 납작해진다. */
const bandTop = {
  narrow: 'top-[clamp(14px,4.7%,22px)]',
  wide: 'top-[clamp(18px,6.8%,36px)]',
} as const

const bandBottom = {
  narrow: 'bottom-[clamp(14px,4.7%,22px)]',
  wide: 'bottom-[clamp(18px,6.8%,36px)]',
} as const

/** 상단 크라운·하단 스크림 깊이. narrow가 더 깊은 이유는 아래 카피(15px 태그라인)가
    wide 제목(66px 볼드)보다 작은 글자라 더 어두운 바닥을 요구하기 때문이다. */
const cardCrown = { narrow: 'h-[30%]', wide: 'h-[26%]' } as const
const cardScrim = { narrow: 'h-[28%]', wide: 'h-[26%]' } as const

/**
 * 카드 안 플레이 CTA. 화면에서 **유일하게** 채운 레드 + 글로우를 갖는 요소다.
 * <p>
 * 보이는 글자는 `플레이`뿐이다 — 게임 이름은 카드 반대편 모서리의 h2가 이미 말했다.
 * 접근 가능한 이름에는 게임 이름을 붙여 버튼 목록만 훑는 사용자도 무엇을 여는지 알게
 * 한다(보이는 글자가 그 이름에 포함되므로 WCAG 2.5.3 Label in Name을 만족한다).
 * <p>
 * 두 상태의 버튼 <b>높이가 같다.</b> 캐러셀이 카드를 미끄러뜨릴 때 이 자리가 위아래로 뛰면
 * 슬라이드가 흔들려 보인다 — 그래서 준비 중 안내 한 줄은 걷어냈다. 못 누르는 회색 버튼이
 * 이미 같은 말을 한다. 두 상태의 폭이 거의 같은 것도 중요하다 — 모서리에 선 요소는 폭이
 * 뛰면 카드 균형이 게임마다 흔들린다.
 */
const playCta =
  'flex cursor-pointer items-center justify-center gap-3.5 rounded-panel border-0 bg-landing-accent font-bold text-landing-accent-ink transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3'
const lockedCta =
  'flex cursor-not-allowed items-center justify-center gap-3.5 rounded-panel border border-landing-hairline-strong bg-landing-disabled font-bold text-landing-text-faint'

/** narrow는 카드 폭을 꽉 채우고(엄지 사거리), wide는 우하단 모서리에 제 폭으로 선다. */
const playCtaSize = {
  narrow: 'h-15 w-full text-lg shadow-landing-cta-sheet',
  wide: 'h-18 shrink-0 px-13 text-2xl shadow-landing-cta',
} as const

const lockedCtaSize = {
  narrow: 'h-15 w-full text-lg',
  wide: 'h-18 shrink-0 px-14 text-xl',
} as const

function HeroCta({ game, layout, onPlay }: LandingHeroCardProps) {
  if (!game.live) {
    return (
      <button
        aria-label="준비 중인 게임"
        className={cn(lockedCta, lockedCtaSize[layout])}
        disabled
        type="button"
      >
        <span aria-hidden="true" className="size-2.5 rounded-xs bg-current" />
        준비 중
      </button>
    )
  }

  return (
    <button
      aria-label={`${game.name} 플레이`}
      className={cn(playCta, playCtaSize[layout])}
      onClick={onPlay}
      type="button"
    >
      <PlayGlyph />
      플레이
    </button>
  )
}

function PlayGlyph() {
  return (
    <span
      aria-hidden="true"
      className="size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-current"
    />
  )
}

interface LandingMetaPillsProps {
  game: Game
  layout: 'narrow' | 'wide'
}

/** 필 치수. narrow가 한 단 작은 이유는 순전히 폭이다 — 390에서 카드 안쪽이 297px이고
    세 칸 합이 273px이라 여기서 한 단만 키워도 두 줄로 접힌다. 접히면 하단 덩어리가
    36px 두꺼워진다. */
const metaPillSize = {
  narrow: 'h-7.5 px-1.5 text-2xs',
  wide: 'h-8.5 px-3 text-xs',
} as const

const metaBadgeSize = {
  narrow: 'text-2xs',
  wide: 'text-xs',
} as const

/**
 * 인원 · 소요 시간 · 조작 세 칸. 첫 칸만 mono 대문자 배지다.
 * <p>
 * 예전 네 번째 칸("실시간 멀티플레이")은 걷었다. 다섯 카드에 똑같이
 * 붙는 값이라 변별 정보가 0인데 가장 넓고(narrow 132px, 행 전체의 44%), 페이지 h1이 이미
 * "…파티 게임"이라고 말한다. 이 칸을 빼야 narrow 필이 한 줄에 든다.
 */
export function LandingMetaPills({ game, layout }: LandingMetaPillsProps) {
  const pillBase = cn(
    'inline-flex flex-none items-center rounded-full border whitespace-nowrap',
    metaPillSize[layout],
  )

  return (
    <>
      <span
        className={cn(
          pillBase,
          'font-mono font-bold tracking-[0.12em]',
          metaBadgeSize[layout],
          game.live
            ? 'border-landing-accent/45 bg-landing-accent-tint text-landing-accent-text'
            : 'border-landing-hairline-strong bg-landing-well text-landing-text-strong',
        )}
      >
        {game.players}
      </span>
      {[game.duration, game.control].map((label) => (
        <span
          className={cn(
            pillBase,
            'border-landing-hairline-strong bg-landing-well font-semibold text-landing-text-strong',
          )}
          key={label}
        >
          {label}
        </span>
      ))}
    </>
  )
}
