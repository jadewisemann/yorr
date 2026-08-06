import { cn } from '@/shared/cn'
import type { LandingHeroCardProps } from './types'

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
/** 카드 안쪽 액자. 네 모서리가 보이는 순간 비대칭(예전 left-11 / right-10)은 실수로 읽힌다. */
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
// 눌림은 공통 Button과 같은 값(scale 0.97)이다. 이 앱에서 가장 많이 눌리는 자리인데
// 그것만 빠져 있었다 — 터치에서는 hover가 없어 누른 순간 아무 반응이 없었다.
const playCta =
  'flex cursor-pointer items-center justify-center gap-3.5 rounded-panel border-0 bg-landing-accent font-bold text-landing-accent-ink transition-[color,background-color,border-color,scale] duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3 active:scale-[0.97]'

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

export function HeroCta({ game, layout, onPlay }: LandingHeroCardProps) {
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
