import { type CSSProperties, useId } from 'react'

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

/** 몸 전체가 움직이는 층 — 맞으면 젖혀지고, 쓰러지면 발끝을 축으로 넘어간다. */
function bodyMotion(pose: Pose): { className?: string; style?: CSSProperties } {
  if (pose === 'hit') {
    return { className: 'animate-duel-knockback', style: { transformOrigin: BODY_PIVOT } }
  }
  if (pose === 'dead') {
    return {
      className: 'animate-duel-fall',
      style: { transform: 'rotate(-78deg)', transformOrigin: BODY_PIVOT },
    }
  }
  return {}
}

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
   * 이 라운드에 총을 쐈는가. 총알이 떠나는 순간 화염과 반동이 터지고, 그 뒤로도 <b>총은
   * 손에 남는다</b> — 맞아 젖혀지는 순간 총이 사라지면 검은 실루엣만 남아 팔이 통째로
   * 없어진 것처럼 보인다(화면에서 유일하게 밝은 것이 총이다).
   */
  fired?: boolean
  height?: number | string
}

export function Gunslinger({
  pose,
  outfit,
  fired = false,
  flip = false,
  height = '100%',
}: GunslingerProps) {
  const [upperArm, foreArm] = ARM[pose]
  const armed = fired || pose === 'draw'
  // 화염·반동은 겨눈 자세에서만 터진다. 자세가 바뀔 때마다 다시 재생되면 맞는 순간
  // 총구가 한 번 더 번쩍인다 — 맞은 사람이 스스로 쏜 것처럼 보인다.
  const shooting = fired && pose === 'draw'
  const down = pose === 'dead'
  /**
   * 뽑기는 스냅, 맞거나 쓰러지는 것은 이어서 움직인다.
   *
   * 퀵드로우는 "한 프레임에 뽑히는" 게 맛이라 보간하지 않는다. 반대로 피격은 몸이
   * 애니메이션으로 젖혀지는 동안 팔만 순간이동하면 그 불일치가 버벅임으로 읽힌다 —
   * 총이 43px을 한 프레임에 건너뛴다.
   *
   * 이징은 앞이 완만한 ease-out 계열이어야 한다. 처음이 급한 곡선(0.2, 0.7, …)은 첫
   * 프레임에 절반(22px)을 가버려서, 전환을 걸어도 여전히 튄 것으로 읽힌다.
   */
  const transition =
    pose === 'hit' || down ? 'transform 260ms cubic-bezier(0.33, 1, 0.68, 1)' : undefined
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

      {/*
        국면이 바뀔 때 이 그룹을 다시 만들지 않는다(key 없음 — 라운드마다 Arena가 통째로
        새로 마운트된다). 다시 만들면 안쪽 팔이 이전 각도를 잃어 전환이 끊기고, 코트가
        흔들리는 주기도 매번 처음으로 되돌아간다. 한 라운드에 자세는 한 번만 바뀌므로
        넉백·낙하는 class가 붙는 것만으로 한 번 재생된다.
      */}
      <g {...bodyMotion(pose)}>
        <Body gradientId={gradientId} hatless={down} outfit={outfit} />

        {/* 총 든 팔 (어깨 → 팔꿈치 → 손/리볼버).
            층을 잘게 나눈 이유: CSS 애니메이션과 전환은 transform 속성을 <b>덮어쓴다</b>.
            위치(translate)·반동·자세 각도를 한 층에 두면 반동이 재생되는 순간 팔뚝과 총이
            어깨로 끌려 올라간다. */}
        <g transform="translate(54 64)">
          <g style={{ transform: `rotate(${upperArm}deg)`, transformOrigin: '0 0', transition }}>
            <path d="M -5.5 -5 L 5.5 -5 L 4 25 L -4 25 Z" fill="#150a11" />
            <g transform="translate(0 25)">
              <g className={shooting ? 'animate-duel-recoil' : undefined}>
                <g
                  style={{ transform: `rotate(${foreArm}deg)`, transformOrigin: '0 0', transition }}
                >
                  <path d="M -4.2 0 L 4.2 0 L 3.2 21 L -3.2 21 Z" fill="#1c0e17" />
                  <circle cx="0" cy="23" fill="#241118" r="4.2" />
                  {armed ? <Revolver firing={shooting} flash={outfit.rim} /> : null}
                </g>
              </g>
            </g>
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
