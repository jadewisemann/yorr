import { useId } from 'react'

/**
 * 총잡이 캐릭터 — 인라인 SVG, 외부 에셋 0.
 *
 * 석양을 등진 실루엣 + 따뜻한 림라이트로 그린다. 기본 방향은 "오른쪽을 향해 서 있는"
 * 모습이고 flip으로 좌우를 뒤집는다.
 *
 * 포즈는 ready(홀스터에 손) · draw(겨눔 + 총구 화염) · hit(뒤로 젖혀짐) ·
 * dead(넘어짐, 모자가 굴러간다) 네 가지다.
 *
 * 팔은 어깨·팔꿈치 두 관절을 각도로만 돌린다. 퀵드로우는 "한 프레임에 뽑히는" 게 맛이라
 * 보간 없이 스냅으로 바꾸고, 반동·넉백만 CSS 애니메이션으로 얹는다.
 */

export type Pose = 'ready' | 'draw' | 'hit' | 'dead'

/** 진영 색 — 스카프·모자띠·총구 화염에 쓰여 두 캐릭터를 구분한다. */
export interface Outfit {
  /** 스카프·모자띠 (진영 색) */
  scarf: string
  /** 림라이트 (석양 반사) */
  rim: string
}

export const OUTFIT_LEFT: Outfit = { scarf: '#e0483a', rim: '#ffb56b' }
export const OUTFIT_RIGHT: Outfit = { scarf: '#38bdf8', rim: '#ffd08a' }

/** 넘어질 때 몸이 도는 축 · 굴러간 모자가 도는 축 — SVG 좌표계 기준이다. */
const BODY_PIVOT = '58px 172px'
const HAT_PIVOT = '96px 168px'

/** 포즈별 팔 각도 — [어깨, 팔꿈치] (deg, SVG rotate) */
const ARM: Record<Pose, [number, number]> = {
  // 아래로 내려 홀스터 위에 손
  ready: [12, 8],
  // 앞으로 뻗어 수평 조준
  draw: [-72, -22],
  // 위로 튕겨 올라감
  hit: [-138, 34],
  // 늘어짐
  dead: [-28, 18],
}

interface GunslingerProps {
  pose: Pose
  outfit: Outfit
  /** true = 왼쪽을 향해 서기 (오른쪽 진영) */
  flip?: boolean
  /**
   * 지금 방아쇠를 당겼는가 — 화염과 반동이 여기서 터진다.
   *
   * 뽑는 것(draw 자세)과 쏘는 것을 나눈 이유: 총알은 판정이 나야 방향이 정해지는데,
   * 화염을 뽑는 순간에 터뜨리면 최대 700ms 뒤에 날아가는 총알과 따로 노는 두 동작으로
   * 보인다. 뽑기는 탭한 즉시 보여 주고, 발사는 총알이 떠나는 순간에 맞춘다.
   */
  firing?: boolean
  /** 총을 쏜 라운드마다 바뀌는 키 — 반동·화염 애니메이션을 다시 재생시킨다. */
  fxKey?: number
  height?: number | string
}

export function Gunslinger({
  pose,
  outfit,
  firing = false,
  flip = false,
  fxKey = 0,
  height = '100%',
}: GunslingerProps) {
  const [upperArm, foreArm] = ARM[pose]
  const armed = pose === 'draw'
  const shooting = armed && firing
  const down = pose === 'dead'
  // 한 화면에 여러 총잡이가 있어도 그라디언트가 섞이지 않게 인스턴스별 id를 쓴다.
  const gradientId = `duel-body-${useId().replace(/:/g, '')}`

  return (
    <svg
      aria-hidden="true"
      height={height}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, overflow: 'visible' }}
      viewBox="0 0 120 180"
    >
      <defs>
        {/* 몸통: 앞쪽(석양 반대)이 살짝 밝고 뒤로 갈수록 새카맣게 */}
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#0b0409" />
          <stop offset="60%" stopColor="#1c0e17" />
          <stop offset="100%" stopColor="#3a1c22" />
        </linearGradient>
      </defs>

      {/* 접지 그림자 — 석양이 낮아 길게 늘어진다 */}
      <ellipse cx="58" cy="176" fill="rgb(20 4 8 / 55%)" rx={down ? 46 : 26} ry="5" />

      {/* 쓰러졌으면 몸 전체를 발끝 기준으로 뒤로 넘긴다 */}
      <g
        className={
          pose === 'hit' ? 'animate-duel-knockback' : down ? 'animate-duel-fall' : undefined
        }
        key={`body-${pose}-${shooting}-${fxKey}`}
        style={
          pose === 'hit'
            ? { transformOrigin: BODY_PIVOT }
            : down
              ? { transform: 'rotate(-78deg)', transformOrigin: BODY_PIVOT }
              : undefined
        }
      >
        <Body gradientId={gradientId} hatless={down} outfit={outfit} />

        {/* 총 든 팔 (어깨 → 팔꿈치 → 손/리볼버) */}
        <g transform={`translate(54 64) rotate(${upperArm})`}>
          <path d="M -5.5 -5 L 5.5 -5 L 4 25 L -4 25 Z" fill="#150a11" />
          <g
            className={shooting ? 'animate-duel-recoil' : undefined}
            transform={`translate(0 25) rotate(${foreArm})`}
          >
            <path d="M -4.2 0 L 4.2 0 L 3.2 21 L -3.2 21 Z" fill="#1c0e17" />
            <circle cx="0" cy="23" fill="#241118" r="4.2" />
            {armed ? <Revolver firing={shooting} flash={outfit.rim} /> : null}
          </g>
        </g>

        {/* 대기 자세에서는 허리에 홀스터가 보인다 */}
        {pose === 'ready' && (
          <g>
            <path d="M 46 104 L 58 104 L 56 122 L 47 121 Z" fill="#2b1410" />
            <path d="M 48 100 L 57 100 L 56.5 106 L 48.5 106 Z" fill="#3d1d16" />
            <path d="M 42 98 L 62 98 L 62 103 L 42 103 Z" fill="#33170f" />
          </g>
        )}
      </g>

      {/* 쓰러질 때 벗겨져 굴러간 모자 */}
      {down && (
        <g className="animate-duel-hatoff" style={{ transformOrigin: HAT_PIVOT }}>
          <ellipse cx="96" cy="171" fill="#150a11" rx="17" ry="4.5" />
          <path d="M 87 171 Q 96 158 105 171 Z" fill="#1e0f16" />
          <path
            d="M 87.5 168 Q 96 165 104.5 168 L 104 171 L 88 171 Z"
            fill={outfit.scarf}
            opacity="0.85"
          />
        </g>
      )}
    </svg>
  )
}

/** 몸통·다리·모자 — 넓게 벌린 결투 자세의 실루엣 */
function Body({
  gradientId,
  hatless,
  outfit,
}: {
  gradientId: string
  hatless: boolean
  outfit: Outfit
}) {
  return (
    <g>
      {/* 뒤로 날리는 더스터 코트 자락 */}
      <path
        className="animate-duel-coat"
        d="M 44 72 L 24 136 L 41 130 L 45 106 Z"
        fill="#100610"
        style={{ transformOrigin: '45px 74px' }}
      />

      {/* 다리 — 좌우로 벌린 스탠스 (뒷다리 먼저) */}
      <path d="M 50 100 L 63 100 L 53 168 L 38 168 Z" fill="#100710" />
      <path d="M 36 164 L 55 164 L 56 172 L 34 172 Z" fill="#0a0409" />
      <path d="M 61 100 L 74 100 L 89 168 L 74 168 Z" fill={`url(#${gradientId})`} />
      <path d="M 72 164 L 91 164 L 92 172 L 70 172 Z" fill="#0a0409" />

      {/* 벨트 */}
      <path d="M 43 96 L 79 96 L 80 104 L 42 104 Z" fill="#0d0509" />
      <rect fill={outfit.scarf} height="8" opacity="0.8" rx="1.5" width="8" x="57" y="96" />

      {/* 상체 (어깨 살짝 둥글게) */}
      <path d="M 45 62 Q 60 52 76 62 L 80 98 L 42 98 Z" fill={`url(#${gradientId})`} />

      {/* 스카프 */}
      <path d="M 50 58 L 72 58 L 62 76 Z" fill={outfit.scarf} />
      <path d="M 62 76 L 56 74 L 58 66 Z" fill={outfit.scarf} opacity="0.7" />

      {/* 목·머리 */}
      <rect fill="#150a11" height="10" width="12" x="55" y="48" />
      <circle cx="61" cy="45" fill="#1a0c13" r="10" />

      {!hatless && (
        <g>
          {/* 챙 — 이 게임에서 가장 알아보기 쉬운 실루엣이라 크게 */}
          <ellipse cx="59" cy="38" fill="#150a11" rx="37" ry="6.5" transform="rotate(-3 59 38)" />
          <path d="M 43 38 L 46 17 Q 60 9 75 17 L 78 38 Z" fill="#1c0e17" />
          {/* 모자띠 (진영 색) */}
          <path d="M 43.4 34 Q 60 30 77.6 34 L 78 38 L 43 38 Z" fill={outfit.scarf} opacity="0.9" />
          {/* 챙 앞쪽 림라이트 */}
          <path d="M 78 34 Q 92 36 96 38.5 Q 90 41 78 41.5 Z" fill={outfit.rim} opacity="0.35" />
        </g>
      )}

      {/* 앞쪽 윤곽 림라이트 — 석양이 몸의 앞선을 훑는다 */}
      <path d="M 76 62 L 80 98 L 80.5 104 L 74 100 L 74.5 64 Z" fill={outfit.rim} opacity="0.3" />
    </g>
  )
}

/** 리볼버 — 손 위치에서 팔 방향(+y)으로 뻗는다. 화염은 방아쇠를 당긴 순간에만 터진다. */
function Revolver({ firing, flash }: { firing: boolean; flash: string }) {
  return (
    <g>
      <path d="M -4.5 17 L 1.5 19 L 0.5 27 L -5.5 25 Z" fill="#2b1a14" />
      {/* 실린더·프레임 */}
      <rect fill="#3a3a44" height="8" rx="1.8" width="6.5" x="-3" y="22" />
      {/* 배럴 */}
      <rect fill="#4a4a56" height="14" rx="1.2" width="3.4" x="-1.6" y="29" />
      {firing && (
        <g className="animate-duel-muzzle" style={{ transformOrigin: '0px 43px' }}>
          <path d="M 0 60 L -7 45 L -2.5 43.5 L 0 30 L 2.5 43.5 L 7 45 Z" fill={flash} />
          <circle cx="0" cy="44" fill="#fff3d0" opacity="0.9" r="6.5" />
          <circle cx="0" cy="46" fill={flash} opacity="0.28" r="12" />
        </g>
      )}
    </g>
  )
}
