import type { Game, GameKey } from '@/games'
import { cn } from '@/shared/cn'
import { PartyModeEntry } from './PartyModeEntry'

interface LandingGameListProps {
  games: readonly Game[]
  layout: 'narrow' | 'wide'
  /** 파티 모드/AI 대전 — 카드가 어느 게임인지 함께 알린다. */
  onPartyMode: (key: GameKey) => void
  /** 플레이 CTA. 모드 선택(PlayModeDialog)은 호출한 쪽이 연다. */
  onPlay: (key: GameKey) => void
  onTutorial: () => void
}

/**
 * 카드 상단 "어떻게 노는지" 자리. 전용 일러스트가 아직 없어 조작을 말하는 글리프 + 조작
 * 라벨로 대신한다.
 */
// ponytail: 기획 이미지 에셋이 확보되면 이 맵만 이미지 경로로 바꾸면 된다.
const controlArt: Record<GameKey, string> = {
  yacht: '📳',
  pingpong: '🏓',
  duel: '🤠',
  liars: '🎭',
  fishing: '🎣',
}

/**
 * 게임 선택 카드 목록(S15P11A406-213). 캐러셀(한 번에 한 장)을 대신한다 — 다섯 게임을
 * 나란히 놓고 비교하는 일은 목록이 더 잘한다. 카드는 위에서 아래로
 * 어떻게 노는지 → 무엇인지(이름) → 왜 하는지(설명) 순서로 읽힌다.
 */
export function LandingGameList({
  games,
  layout,
  onPartyMode,
  onPlay,
  onTutorial,
}: LandingGameListProps) {
  return (
    <ul
      className={cn(
        'm-0 grid list-none p-0',
        layout === 'wide' ? 'grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5' : 'gap-4',
      )}
    >
      {games.map((game) => (
        <li className="min-w-0" key={game.key}>
          <GameCard
            game={game}
            onPartyMode={onPartyMode}
            onPlay={onPlay}
            onTutorial={onTutorial}
            wide={layout === 'wide'}
          />
        </li>
      ))}
    </ul>
  )
}

function GameCard({
  game,
  onPartyMode,
  onPlay,
  onTutorial,
  wide,
}: {
  game: Game
  onPartyMode: (key: GameKey) => void
  onPlay: (key: GameKey) => void
  onTutorial: () => void
  wide: boolean
}) {
  return (
    <article
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-[26px] border [background:var(--ds-landing-card)]',
        game.live
          ? 'border-landing-accent/42 shadow-landing-card'
          : 'border-landing-hairline-strong shadow-landing-card-quiet',
      )}
    >
      {/* 상단: 어떻게 노는지. 글리프가 장식이 아니라 조작 방식의 예고라 라벨과 짝으로 선다. */}
      <div className="relative flex h-31 flex-none flex-col items-center justify-center gap-2.5 border-b border-landing-hairline [background:var(--ds-landing-card-crown)]">
        <span aria-hidden="true" className="text-[42px]/none">
          {controlArt[game.key]}
        </span>
        <span className="rounded-full border border-landing-hairline-strong bg-landing-well px-3 py-1 text-[12px] font-semibold text-landing-text-strong">
          {game.control}
        </span>
      </div>

      {/* 가운데: 이름과 카피. 페이지 제목(h1)은 랜딩 카피가 갖고 있으므로 카드는 h2다. */}
      <div className="flex flex-1 flex-col gap-1.5 px-5 pt-4">
        <h2 className="m-0 text-[22px]/[1.15] font-bold tracking-[-0.03em] text-landing-text">
          {game.name}
        </h2>
        <p className="m-0 text-pretty text-[14px]/[1.35] font-semibold text-landing-text-strong">
          {game.tagline}
        </p>
        {/* 하단: 설명. 카드에서 가장 작게 읽히는 줄이다. */}
        <p className="m-0 text-pretty text-[13px]/[1.45] text-landing-text-muted">
          {game.description}
        </p>
        <div className="mt-1 flex min-w-0 flex-nowrap gap-1.5">
          <LandingMetaPills game={game} />
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 pt-3 pb-5">
        {/* 연습 입구는 실전 CTA 바로 위 — 카드 시절과 같은 위계다. 연습이 있는 게임은 야추뿐. */}
        {game.key === 'yacht' && (
          <button
            className="cursor-pointer self-start border-0 bg-transparent p-1 text-[13px] font-semibold text-landing-text-muted underline underline-offset-4 transition-colors duration-150 ease-out hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2"
            onClick={onTutorial}
            type="button"
          >
            처음이신가요? 튜토리얼로 연습하기
          </button>
        )}
        <div className={cn(showSecondaryAction(wide, game) ? 'grid grid-cols-2 gap-2' : 'flex')}>
          {showSecondaryAction(wide, game) && (
            <PartyModeEntry
              kind={game.key === 'pingpong' ? 'ai' : 'party'}
              layout="narrow"
              onOpen={() => onPartyMode(game.key)}
            />
          )}
          <CardCta game={game} onPlay={onPlay} />
        </div>
      </div>
    </article>
  )
}

/** 파티 모드는 큰 화면이 있어야 성립한다 — 캐러셀 카드 시절과 같은 노출 규칙을 유지한다. */
function showSecondaryAction(wide: boolean, game: Game) {
  return game.live && (wide || game.key === 'pingpong')
}

/**
 * 카드의 플레이 CTA. 두 상태(플레이/준비 중)의 높이가 같아 목록의 카드 높이가 게임마다
 * 흔들리지 않는다. 접근 가능한 이름 규칙은 캐러셀 카드 시절 그대로다(WCAG 2.5.3).
 */
function CardCta({ game, onPlay }: { game: Game; onPlay: (key: GameKey) => void }) {
  if (!game.live) {
    return (
      <button
        aria-label="준비 중인 게임"
        className="flex h-15 w-full cursor-not-allowed items-center justify-center gap-3 rounded-[20px] border border-landing-hairline-strong bg-landing-disabled text-[16px] font-bold text-landing-text-faint"
        disabled
        type="button"
      >
        <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-current" />
        준비 중
      </button>
    )
  }

  return (
    <button
      aria-label={game.key === 'pingpong' ? '탁구 친구와 대전' : `${game.name} 플레이`}
      className="flex h-15 w-full cursor-pointer items-center justify-center gap-3 rounded-[20px] border-0 bg-landing-accent text-[17px] font-bold text-landing-accent-ink shadow-landing-cta-sheet transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3"
      onClick={() => onPlay(game.key)}
      type="button"
    >
      <span
        aria-hidden="true"
        className="size-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-current"
      />
      {game.key === 'pingpong' ? '친구와 대전' : '플레이'}
    </button>
  )
}

/**
 * 인원 · 소요 시간 두 칸. 캐러셀 카드의 세 칸에서 조작 칸을 뺐다 — 조작은 이제 카드 상단이
 * 글리프+라벨로 더 크게 말한다. 첫 칸만 mono 대문자 배지다.
 */
function LandingMetaPills({ game }: { game: Game }) {
  const pillBase =
    'inline-flex h-7.5 flex-none items-center rounded-full border px-2.5 whitespace-nowrap text-[11px]'

  return (
    <>
      <span
        className={cn(
          pillBase,
          'font-mono font-bold tracking-[0.12em]',
          game.live
            ? 'border-landing-accent/45 bg-landing-accent-tint text-landing-accent-text'
            : 'border-landing-hairline-strong bg-landing-well text-landing-text-strong',
        )}
      >
        {game.players}
      </span>
      <span
        className={cn(
          pillBase,
          'border-landing-hairline-strong bg-landing-well font-semibold text-landing-text-strong',
        )}
      >
        {game.duration}
      </span>
    </>
  )
}
