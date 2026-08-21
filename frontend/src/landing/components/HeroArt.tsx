import type { GameKey } from '@/games'

/**
 * 히어로 3D의 프리렌더 에셋. 살아 있는 three.js 씬(옛 HeroCanvas)을 대체한다 —
 * 장면은 `scripts/bake-hero.mjs`가 heroScene.ts를 오프라인에서 돌려 굽고, 런타임은
 * 이 <img> 한 장과 CSS 모션만 진다. 첫 화면에서 three.js(gzip 127KB)와 WebGL
 * 렌더 루프가 빠지고, 그 대가로 잃는 것은 개별 주사위의 idle 회전과 포인터 시차다.
 *
 * reduced-motion·saveData·WebGL 불가 사용자도 이제 같은 그림을 본다 — 살아 있는
 * 씬 시절에는 셋 다 빈 그라디언트였다.
 *
 * object-cover가 라이브 프레이밍의 재현이다: 씬의 피사체 크기는 컨테이너 높이에
 * 비례했으므로(세로 FOV 고정), 높이를 채우고 옆을 자르는 cover가 같은 규칙이 된다.
 * 프레이밍이 레이아웃마다 다른 이유는 bake-hero.mjs 머리말 참고.
 */
export function heroArtSrc(game: GameKey, layout: 'narrow' | 'wide'): string {
  return `/hero/${game}-${layout}.webp`
}

interface HeroArtProps {
  game: GameKey
  layout: 'narrow' | 'wide'
}

export function HeroArt({ game, layout }: HeroArtProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* key=game — 카드가 바뀔 때마다 등장 모션을 처음부터 다시 튼다. */}
      <img
        key={game}
        alt=""
        className="h-full w-full object-cover motion-safe:animate-hero"
        decoding="async"
        draggable={false}
        src={heroArtSrc(game, layout)}
      />
    </div>
  )
}
