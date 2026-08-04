import type { ReactNode } from 'react'
import { BULLET_MS, isClean, msLabel, slots } from './duel'
import { Gunslinger, type Outfit, type Pose } from './Gunslinger'

/**
 * 결투 무대 — 순수 표현 컴포넌트.
 *
 * 석양의 황야, 머리 위에 매달린 신호등, 좌우로 마주 선 두 총잡이. 규칙도 네트워크도 모른다.
 * 부모가 "지금 이 화면"만 넘겨주면 그린다("나"를 항상 왼쪽에 두는 배치도 부모 책임이다).
 *
 * 좌표 기준: 지평선 = 위에서 72%. 캐릭터는 지평선에 발을 딛는다(bottom 28%). 캐릭터 키는
 * --gs-h 하나로 관리하고 총알 높이도 여기서 파생시킨다.
 */

export type ArenaPhase = 'waiting' | 'signal' | 'result'

export interface Fighter {
  name: string
  pose: Pose
  outfit: Outfit
  hp: number
  /** 이번 라운드 기록. 결과 국면에서만 쓴다. */
  ms: number | null
  /** 쌓인 부정출발 경고 — 이름표에 삼각형으로 표시된다. */
  fouls: number
}

interface ArenaProps {
  phase: ArenaPhase
  round: number
  maxHp: number
  maxFouls: number
  left: Fighter
  right: Fighter
  /** 결과에서 상대를 쏜 쪽 — 뷰 기준(1=왼쪽 · 2=오른쪽 · 0=아무도). */
  winner: 0 | 1 | 2
  tie: boolean
  /** 부정출발한 쪽 — 뷰 기준. 0이 아니면 파울 라운드다. */
  foulSide: 0 | 1 | 2
  /** 경고가 차서 자기 발을 쏜 라운드인가. */
  selfShot: boolean
  /** 이번 라운드로 승부가 끝났는가 (K.O. 문구). */
  ko: boolean
  /** 내 기록은 나왔고 상대를 기다리는 중. */
  pending: boolean
  /** 대기 중 조작 안내. */
  hint: string
  /** 신호 순간의 조작 라벨 (SPACE · 휘둘러! · TAP). */
  actLabel: string
  /** 라운드마다 증가 — 연출 애니메이션을 처음부터 다시 재생시킨다. */
  fxKey: number
  /** 위에 겹칠 것들 (탭 존, 오버레이 등). */
  children?: ReactNode
}

const LABEL_MONO = 'font-mono text-[11px] tracking-[0.16em] uppercase'

/** 국면별 하늘 — 신호가 뜨면 황야 전체가 초록으로 뒤집힌다. */
function sky(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'linear-gradient(#02130d 0%, #0b3a25 32%, #17794a 60%, #35c06a 82%, #a7f3c4 100%)'
  if (phase === 'result')
    return 'linear-gradient(#14060f 0%, #33101f 34%, #6d2422 62%, #a94a26 84%, #cf8236 100%)'
  return 'linear-gradient(#1a0a18 0%, #431330 34%, #8d2f2c 62%, #d4622c 84%, #f5a944 100%)'
}

function ground(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'linear-gradient(#33955a 0%, #145030 26%, #071c13 70%, #030b08 100%)'
  if (phase === 'result')
    return 'linear-gradient(#8a4526 0%, #4a2016 26%, #1a0a0b 70%, #0a0405 100%)'
  return 'linear-gradient(#a35a2c 0%, #5d2a19 26%, #210d0d 70%, #0c0506 100%)'
}

function sun(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'radial-gradient(circle, #f0fff5 0%, #86efac 38%, #34d399 66%, rgb(16 185 129 / 0%) 72%)'
  return 'radial-gradient(circle, #fff3cd 0%, #ffcf72 34%, #ff9a3c 60%, rgb(232 83 42 / 0%) 72%)'
}

export function Arena({
  phase,
  round,
  maxHp,
  maxFouls,
  left,
  right,
  winner,
  tie,
  foulSide,
  selfShot,
  ko,
  pending,
  hint,
  actLabel,
  fxKey,
  children,
}: ArenaProps) {
  const settled = phase === 'result' && !pending
  // 상대를 향해 총알이 날아가는 라운드 (파울 라운드는 상대에게 안 간다)
  const firing = settled && foulSide === 0 && (tie || winner !== 0)
  // 파울 라운드 — 총알은 자기 발밑으로 (경고면 땅, 경고 소진이면 자기 발)
  const foulShot = settled && foulSide !== 0

  return (
    <div
      className={`relative w-full flex-1 overflow-hidden ${firing || foulShot ? 'animate-duel-shake' : ''}`}
      key={`arena-${fxKey}`}
      style={{ ['--gs-h' as string]: 'clamp(112px, 25vh, 208px)' }}
    >
      <Wasteland phase={phase} />

      <SignalLamp phase={phase} round={round} />

      <div className="absolute" style={{ left: 12, top: 50 }}>
        <Plate align="left" fighter={left} maxFouls={maxFouls} maxHp={maxHp} />
      </div>
      <div className="absolute" style={{ right: 12, top: 50 }}>
        <Plate align="right" fighter={right} maxFouls={maxFouls} maxHp={maxHp} />
      </div>

      <div
        className="absolute"
        style={{ bottom: '28%', left: '17%', transform: 'translateX(-50%)' }}
      >
        <Gunslinger fxKey={fxKey} height="var(--gs-h)" outfit={left.outfit} pose={left.pose} />
      </div>
      <div
        className="absolute"
        style={{ bottom: '28%', right: '17%', transform: 'translateX(50%)' }}
      >
        <Gunslinger
          flip
          fxKey={fxKey}
          height="var(--gs-h)"
          outfit={right.outfit}
          pose={right.pose}
        />
      </div>

      {firing && <Bullets left={left} right={right} tie={tie} winner={winner} />}
      {foulShot && <FoulDust foulSide={foulSide} selfShot={selfShot} />}
      {firing && !tie && <ImpactFlash winner={winner} />}

      <Headline
        actLabel={actLabel}
        foulSide={foulSide}
        hint={hint}
        ko={ko}
        left={left}
        maxFouls={maxFouls}
        pending={pending}
        phase={phase}
        right={right}
        selfShot={selfShot}
        tie={tie}
        winner={winner}
      />

      {/* 발밑 기록표 */}
      {phase === 'result' && (
        <>
          <TimeTag ms={left.ms} side="left" tie={tie} won={winner === 1} />
          <TimeTag ms={right.ms} side="right" tie={tie} won={winner === 2} />
        </>
      )}

      {children}
    </div>
  )
}

/**
 * 황야 — 하늘·태양·메사·땅·소품·비네트. 국면 색만 받고 나머지는 고정이라
 * 무대의 인물·연출과 섞이지 않게 따로 둔다.
 */
function Wasteland({ phase }: { phase: ArenaPhase }) {
  const green = phase === 'signal'
  return (
    <>
      <div className="absolute inset-x-0 top-0" style={{ background: sky(phase), height: '72%' }} />

      {/* 태양 후광 → 태양 (지평선에 반쯤 걸려 있다) */}
      <div
        className="absolute rounded-full"
        style={{
          aspectRatio: '1',
          background: green
            ? 'radial-gradient(circle, rgb(52 211 153 / 36%) 0%, rgb(52 211 153 / 0%) 60%)'
            : 'radial-gradient(circle, rgb(255 138 60 / 34%) 0%, rgb(255 90 40 / 0%) 60%)',
          left: '50%',
          top: '72%',
          transform: 'translate(-50%,-50%)',
          width: '124vmin',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          aspectRatio: '1',
          background: sun(phase),
          left: '50%',
          top: '72%',
          transform: 'translate(-50%,-50%)',
          width: 'clamp(150px, 42vmin, 330px)',
        }}
      />

      {/* 원경 메사(테이블 마운틴) 실루엣 */}
      <svg
        aria-hidden="true"
        className="absolute inset-x-0"
        preserveAspectRatio="none"
        style={{ height: '29%', top: '43%' }}
        viewBox="0 0 400 100"
      >
        <polygon
          fill={green ? '#0c3f28' : '#40152a'}
          opacity="0.9"
          points="0,100 0,70 30,66 44,44 84,44 96,64 132,66 152,26 198,26 210,54 252,58 272,34 306,34 322,60 356,56 376,70 400,66 400,100"
        />
      </svg>
      {/* 근경 능선 */}
      <svg
        aria-hidden="true"
        className="absolute inset-x-0"
        preserveAspectRatio="none"
        style={{ height: '10.5%', top: '62%' }}
        viewBox="0 0 400 40"
      >
        <polygon
          fill={green ? '#04251a' : '#26091a'}
          points="0,40 0,27 42,20 92,25 142,14 202,19 252,12 312,21 360,16 400,23 400,40"
        />
      </svg>

      {/* 지평선 열기 (모래 먼지가 빛을 먹는 느낌) */}
      <div
        className="absolute inset-x-0"
        style={{
          background: green
            ? 'linear-gradient(rgb(167 243 196 / 0%), rgb(167 243 196 / 50%), rgb(167 243 196 / 0%))'
            : 'linear-gradient(rgb(255 196 120 / 0%), rgb(255 196 120 / 55%), rgb(255 196 120 / 0%))',
          filter: 'blur(7px)',
          height: '7%',
          top: '69%',
        }}
      />

      <div
        className="absolute inset-x-0 bottom-0"
        style={{ background: ground(phase), height: '28%' }}
      />
      {/* 모래 결 */}
      <div
        className="absolute inset-x-0 bottom-0 opacity-25"
        style={{
          background:
            'repeating-linear-gradient(94deg, rgb(0 0 0 / 35%) 0 2px, rgb(0 0 0 / 0%) 2px 22px)',
          height: '28%',
        }}
      />

      <div
        className="absolute"
        style={{ bottom: '25%', height: 'calc(var(--gs-h) * 0.6)', left: '2%' }}
      >
        <Cactus green={green} />
      </div>
      <div
        className="absolute"
        style={{ bottom: '26.5%', height: 'calc(var(--gs-h) * 0.42)', right: '3%' }}
      >
        <Cactus green={green} />
      </div>
      <div
        className="absolute"
        style={{ bottom: '27.4%', height: 'calc(var(--gs-h) * 0.2)', left: '35%' }}
      >
        <Fence green={green} />
      </div>
      {/* 대기 국면의 정적을 재는 유일한 움직임 */}
      {phase === 'waiting' && (
        <div
          className="animate-duel-tumble absolute"
          style={{ bottom: '18%', height: 'calc(var(--gs-h) * 0.15)' }}
        >
          <Tumbleweed />
        </div>
      )}

      {/* 어둡게 조이는 비네트 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 52%, transparent 38%, rgb(6 2 4 / 74%) 100%)',
        }}
      />
    </>
  )
}

/** 총알 — 가슴 높이로 날아간다. TIE면 가운데서 부딪혀 튄다. */
function Bullets({
  left,
  right,
  tie,
  winner,
}: {
  left: Fighter
  right: Fighter
  tie: boolean
  winner: 0 | 1 | 2
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ bottom: 'calc(28% + var(--gs-h) * 0.5)', height: 0, left: '24%', right: '24%' }}
    >
      {tie ? (
        <>
          <Bullet clash color={left.outfit.rim} dir="r" />
          <Bullet clash color={right.outfit.rim} dir="l" />
          <Clash />
        </>
      ) : (
        <Bullet color={(winner === 1 ? left : right).outfit.rim} dir={winner === 1 ? 'r' : 'l'} />
      )}
    </div>
  )
}

/** 부정출발 — 총알이 자기 발밑에 박히며 흙먼지가 인다. 상대에게는 가지 않는다. */
function FoulDust({ foulSide, selfShot }: { foulSide: 0 | 1 | 2; selfShot: boolean }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        [foulSide === 1 ? 'left' : 'right']: '17%',
        bottom: '28%',
        transform: `translateX(${foulSide === 1 ? '-50%' : '50%'})`,
      }}
    >
      {/* 경고 소진(자기 발)이면 더 붉고 크게 */}
      <div
        className="animate-duel-dust absolute"
        style={{
          animationDelay: `${BULLET_MS}ms`,
          aspectRatio: '1',
          background: selfShot
            ? 'radial-gradient(circle, #fff 0%, #ffd0a0 22%, rgb(239 68 68 / 80%) 48%, rgb(120 53 15 / 0%) 72%)'
            : 'radial-gradient(circle, #ffe9c2 0%, rgb(214 150 90 / 70%) 34%, rgb(120 80 40 / 0%) 70%)',
          borderRadius: 999,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: selfShot ? 'calc(var(--gs-h) * 0.62)' : 'calc(var(--gs-h) * 0.44)',
        }}
      />
    </div>
  )
}

/** 피격 섬광 — 총알이 닿는 순간 맞은 쪽에서 터진다. */
function ImpactFlash({ winner }: { winner: 0 | 1 | 2 }) {
  return (
    <div
      className="animate-duel-impact pointer-events-none absolute"
      style={{
        [winner === 1 ? 'right' : 'left']: '17%',
        animationDelay: `${BULLET_MS}ms`,
        aspectRatio: '1',
        background:
          'radial-gradient(circle, #fff 0%, #ffd9a0 26%, rgb(239 68 68 / 85%) 52%, rgb(239 68 68 / 0%) 72%)',
        borderRadius: 999,
        bottom: 'calc(28% + var(--gs-h) * 0.4)',
        transform: `translateX(${winner === 1 ? '50%' : '-50%'})`,
        width: 'calc(var(--gs-h) * 0.52)',
      }}
    />
  )
}

/** 신호등 — 빨강(대기) → 초록(뽑아!) */
function SignalLamp({ phase, round }: { phase: ArenaPhase; round: number }) {
  const green = phase === 'signal'
  const dim = phase === 'result'
  const glow = green ? '#4ade80' : dim ? '#5b2323' : '#ef4444'

  return (
    <div
      className={`pointer-events-none absolute left-1/2 flex flex-col items-center ${
        phase === 'waiting' ? 'animate-duel-sway' : ''
      }`}
      style={{ top: 0, transform: 'translateX(-50%)', transformOrigin: '50% 0%' }}
    >
      {/* 매달린 줄 */}
      <div
        style={{
          background: 'linear-gradient(#8a6a4a, #4b3524)',
          height: 'clamp(12px, 3vh, 28px)',
          width: 3,
        }}
      />
      {/* 고리 */}
      <div
        style={{
          border: '2.5px solid #6b4f36',
          borderBottom: 'none',
          borderRadius: 999,
          height: 8,
          marginBottom: -2,
          width: 14,
        }}
      />
      <div
        className={green ? 'animate-duel-lamp-pop' : ''}
        key={green ? 'green' : dim ? 'dim' : 'red'}
        style={{
          aspectRatio: '1',
          background: green
            ? 'radial-gradient(circle at 40% 34%, #ffffff 0%, #86efac 30%, #22c55e 62%, #14532d 100%)'
            : dim
              ? 'radial-gradient(circle at 40% 34%, #6b3030 0%, #3d1a1a 60%, #180a0a 100%)'
              : 'radial-gradient(circle at 40% 34%, #ffd0d0 0%, #ef4444 32%, #b91c1c 64%, #450a0a 100%)',
          border: '3px solid #2a1a12',
          borderRadius: 999,
          boxShadow: `0 0 ${green ? 48 : 24}px ${glow}, inset 0 0 14px rgb(0 0 0 / 45%)`,
          position: 'relative',
          width: 'clamp(50px, 11vh, 76px)',
        }}
      >
        {/* 철제 살 */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 46%, rgb(20 10 8 / 70%) 46%, rgb(20 10 8 / 70%) 54%, transparent 54%)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(0deg, transparent 46%, rgb(20 10 8 / 50%) 46%, rgb(20 10 8 / 50%) 54%, transparent 54%)',
          }}
        />
      </div>
      {/* 라운드 나무 간판 */}
      <div
        className={`mt-1.5 rounded-[3px] px-3 py-0.5 ${LABEL_MONO}`}
        style={{
          background: 'linear-gradient(#6b4429, #472c1a)',
          border: '1px solid #2a1a10',
          boxShadow: '0 2px 6px rgb(0 0 0 / 50%)',
          color: '#f0d8b0',
          fontSize: 10,
        }}
      >
        ROUND {round}
      </div>
    </div>
  )
}

/** 이름표 + 체력(탄약) */
function Plate({
  align,
  fighter,
  maxFouls,
  maxHp,
}: {
  align: 'left' | 'right'
  fighter: Fighter
  maxFouls: number
  maxHp: number
}) {
  const dead = fighter.hp <= 0
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'} gap-1`}>
      <div
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{
          background: 'rgb(12 4 8 / 60%)',
          border: `1px solid ${fighter.outfit.scarf}66`,
        }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: fighter.outfit.scarf, opacity: dead ? 0.3 : 1 }}
        />
        <span
          className="text-xs font-black tracking-wide whitespace-nowrap"
          style={{ color: dead ? 'rgb(255 255 255 / 35%)' : '#f4e6d0' }}
        >
          {fighter.name}
        </span>
        {/* 부정출발 경고 — 차면 자기 발을 쏜다 */}
        <span className="flex items-center gap-0.5">
          {slots('warn', maxFouls, fighter.fouls).map((slot) => (
            <Warn key={slot.id} lit={slot.filled} />
          ))}
        </span>
      </div>

      <div className={`flex gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {slots('shell', maxHp, fighter.hp).map((slot) => (
          <Shell key={slot.id} live={slot.filled} />
        ))}
      </div>
    </div>
  )
}

/** 경고 한 칸 — 부정출발 누적 (작은 삼각형) */
function Warn({ lit }: { lit: boolean }) {
  return (
    <span
      className="block"
      style={{
        borderBottom: `8px solid ${lit ? '#fbbf24' : 'rgb(255 255 255 / 20%)'}`,
        borderLeft: '4.5px solid transparent',
        borderRight: '4.5px solid transparent',
        filter: lit ? 'drop-shadow(0 0 4px rgb(251 191 36 / 90%))' : undefined,
        height: 0,
        width: 0,
      }}
    />
  )
}

/** 체력 한 칸 = 탄약 한 발 (맞으면 빈 탄피) */
function Shell({ live }: { live: boolean }) {
  return (
    <span
      className="block"
      style={{
        background: live
          ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
          : 'linear-gradient(rgb(255 255 255 / 10%), rgb(255 255 255 / 4%))',
        border: live ? '1px solid #6d4a11' : '1px solid rgb(255 255 255 / 18%)',
        borderRadius: '2px 2px 3px 3px',
        boxShadow: live ? '0 0 6px rgb(217 165 60 / 50%)' : 'none',
        height: 15,
        width: 8,
      }}
    />
  )
}

function Bullet({ clash = false, color, dir }: { clash?: boolean; color: string; dir: 'r' | 'l' }) {
  const animation = clash
    ? dir === 'r'
      ? 'animate-duel-bullet-cr'
      : 'animate-duel-bullet-cl'
    : dir === 'r'
      ? 'animate-duel-bullet-r'
      : 'animate-duel-bullet-l'
  return (
    <div className={`absolute ${animation}`} style={{ top: -2 }}>
      {/* 예광탄 꼬리 + 탄두 */}
      <div
        style={{
          background:
            dir === 'r'
              ? `linear-gradient(90deg, rgb(255 255 255 / 0%) 0%, ${color}99 60%, #fff 100%)`
              : `linear-gradient(90deg, #fff 0%, ${color}99 40%, rgb(255 255 255 / 0%) 100%)`,
          borderRadius: 999,
          boxShadow: `0 0 10px ${color}, 0 0 20px ${color}66`,
          height: 4,
          transform: dir === 'r' ? 'translateX(-100%)' : 'none',
          width: 'clamp(30px, 7vw, 52px)',
        }}
      />
    </div>
  )
}

/** TIE — 총알이 공중에서 부딪혀 튄다 */
function Clash() {
  return (
    <div
      className="animate-duel-clash absolute"
      style={{
        aspectRatio: '1',
        background:
          'radial-gradient(circle, #ffffff 0%, #fff1b8 24%, rgb(251 191 36 / 80%) 46%, rgb(251 191 36 / 0%) 70%)',
        borderRadius: 999,
        left: '50%',
        top: 0,
        width: 'clamp(52px, 13vw, 96px)',
      }}
    />
  )
}

const WRAP = 'pointer-events-none absolute inset-x-0 flex flex-col items-center px-4 text-center'

/**
 * 중앙 헤드라인 — 국면마다 다른 한마디를 같은 자리에 띄운다.
 * 이 화면에서 가장 크게 읽히는 글자라, 무엇을 띄울지 고르는 판단만 여기 모아 둔다.
 */
function Headline({
  actLabel,
  foulSide,
  hint,
  ko,
  left,
  maxFouls,
  pending,
  phase,
  right,
  selfShot,
  tie,
  winner,
}: {
  actLabel: string
  foulSide: 0 | 1 | 2
  hint: string
  ko: boolean
  left: Fighter
  maxFouls: number
  pending: boolean
  phase: ArenaPhase
  right: Fighter
  selfShot: boolean
  tie: boolean
  winner: 0 | 1 | 2
}) {
  if (phase === 'waiting') return <HoldLine hint={hint} />
  if (phase === 'signal') return <DrawLine actLabel={actLabel} />
  if (pending) return <PendingLine ms={left.ms} />
  if (foulSide !== 0) {
    return <FoulLine maxFouls={maxFouls} selfShot={selfShot} who={foulSide === 1 ? left : right} />
  }
  if (tie) return <TieLine left={left} right={right} />
  if (winner === 0) return null
  return <ShotLine ko={ko} shooter={winner === 1 ? left : right} />
}

/** 대기 — 아직 빨강이다. */
function HoldLine({ hint }: { hint: string }) {
  return (
    <div className={WRAP} style={{ top: '31%' }}>
      <div
        className={`animate-pulse ${LABEL_MONO}`}
        style={{ color: '#ffb98a', letterSpacing: '0.34em' }}
      >
        H O L D
      </div>
      <div className="mt-1.5 text-sm font-bold" style={{ color: 'rgb(255 226 196 / 72%)' }}>
        {hint}
      </div>
    </div>
  )
}

/** 신호 — 지금 뽑는다. */
function DrawLine({ actLabel }: { actLabel: string }) {
  return (
    <div className={WRAP} style={{ top: '25%' }}>
      <div
        className="animate-duel-signal-pop font-black"
        style={{
          color: '#f0fff5',
          fontSize: 'clamp(48px, 15vw, 104px)',
          letterSpacing: '-0.02em',
          lineHeight: 0.92,
          textShadow: '0 0 34px rgb(74 222 128 / 95%), 0 4px 0 #14532d',
        }}
      >
        DRAW!
      </div>
      <div
        className="mt-1 font-black tracking-[0.3em]"
        style={{ color: '#dcfce7', fontSize: 'clamp(13px, 3.4vw, 18px)' }}
      >
        {actLabel}
      </div>
    </div>
  )
}

/** 내 기록은 나왔고 상대를 기다린다. */
function PendingLine({ ms }: { ms: number | null }) {
  return (
    <div className={WRAP} style={{ top: '28%' }}>
      <div className="text-4xl font-black tabular-nums" style={{ color: '#ffe9c2' }}>
        {msLabel(ms)}
      </div>
      <div className="mt-2 animate-pulse text-sm" style={{ color: 'rgb(255 220 190 / 72%)' }}>
        상대가 뽑는 걸 기다린다…
      </div>
    </div>
  )
}

/** 부정출발 — 경고가 쌓였거나, 차서 자기 발을 쐈다. */
function FoulLine({
  maxFouls,
  selfShot,
  who,
}: {
  maxFouls: number
  selfShot: boolean
  who: Fighter
}) {
  const color = selfShot ? '#fca5a5' : '#fbbf24'
  return (
    <div className={WRAP} style={{ top: '24%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${BULLET_MS}ms`,
          color,
          fontSize: selfShot ? 'clamp(28px, 8.5vw, 60px)' : 'clamp(40px, 12vw, 84px)',
          lineHeight: 0.95,
          textShadow: `0 0 30px ${color}aa, 0 4px 0 rgb(0 0 0 / 55%)`,
        }}
      >
        {selfShot ? '자기 발을 쐈다!' : 'FOUL!'}
      </div>
      <div
        className="animate-duel-slam mt-1.5 text-sm font-bold"
        style={{ animationDelay: `${BULLET_MS + 90}ms`, color: 'rgb(255 232 205 / 90%)' }}
      >
        {selfShot
          ? `${who.name} — 경고 ${maxFouls}/${maxFouls} · 1발 잃는다`
          : `${who.name} — 신호 전에 뽑았다 · 경고 ${who.fouls}/${maxFouls}`}
      </div>
      <div
        className={`animate-duel-slam mt-1 ${LABEL_MONO}`}
        style={{ animationDelay: `${BULLET_MS + 150}ms`, color: 'rgb(255 220 190 / 60%)' }}
      >
        {selfShot ? '경고 리셋' : '라운드 무효 · 상대 무피해'}
      </div>
    </div>
  )
}

/** 1ms까지 똑같거나, 둘 다 놓쳤다. */
function TieLine({ left, right }: { left: Fighter; right: Fighter }) {
  return (
    <div className={WRAP} style={{ top: '25%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${BULLET_MS}ms`,
          color: '#fde68a',
          fontSize: 'clamp(44px, 13vw, 92px)',
          lineHeight: 0.95,
          textShadow: '0 0 30px rgb(251 191 36 / 85%), 0 4px 0 #78350f',
        }}
      >
        TIE
      </div>
      <div
        className="animate-duel-slam mt-1 text-sm font-bold"
        style={{ animationDelay: `${BULLET_MS + 90}ms`, color: 'rgb(253 230 138 / 85%)' }}
      >
        {isClean(left.ms) && isClean(right.ms)
          ? `1ms 까지 똑같다 — 둘 다 ${left.ms}ms`
          : '둘 다 놓쳤다 — 다시 간다'}
      </div>
    </div>
  )
}

/** 정상 승부 — 먼저 뽑은 쪽이 맞혔다. */
function ShotLine({ ko, shooter }: { ko: boolean; shooter: Fighter }) {
  return (
    <div className={WRAP} style={{ top: '24%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${BULLET_MS}ms`,
          color: ko ? '#fca5a5' : '#fff1d6',
          fontSize: ko ? 'clamp(44px, 13vw, 92px)' : 'clamp(34px, 10vw, 70px)',
          lineHeight: 0.95,
          textShadow: `0 0 30px ${shooter.outfit.scarf}, 0 4px 0 rgb(0 0 0 / 50%)`,
        }}
      >
        {ko ? 'K.O.' : 'HIT!'}
      </div>
      <div
        className="animate-duel-slam mt-1.5 text-sm font-bold"
        style={{ animationDelay: `${BULLET_MS + 90}ms`, color: 'rgb(255 232 205 / 88%)' }}
      >
        {shooter.name} — 먼저 뽑았다
      </div>
    </div>
  )
}

/** 발밑 기록표 */
function TimeTag({
  ms,
  side,
  tie,
  won,
}: {
  ms: number | null
  side: 'left' | 'right'
  tie: boolean
  won: boolean
}) {
  if (ms == null) return null
  const good = isClean(ms)
  const color = tie ? '#fde68a' : won ? '#86efac' : good ? '#fca5a5' : '#f87171'
  return (
    <div
      className="animate-duel-slam pointer-events-none absolute"
      style={{
        [side]: '17%',
        animationDelay: `${BULLET_MS}ms`,
        bottom: 'calc(28% - 30px)',
        transform: `translateX(${side === 'left' ? '-50%' : '50%'})`,
      }}
    >
      <span
        className="rounded-md px-2 py-0.5 text-xs font-black whitespace-nowrap tabular-nums"
        style={{ background: 'rgb(8 3 5 / 72%)', border: `1px solid ${color}55`, color }}
      >
        {msLabel(ms)}
      </span>
    </div>
  )
}

function Cactus({ green }: { green: boolean }) {
  const color = green ? '#04251a' : '#22071a'
  return (
    <svg aria-hidden="true" height="100%" viewBox="0 0 40 80">
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 79 L20 10" strokeWidth="10" />
        <path d="M20 42 L11 42 L11 24" strokeWidth="7" />
        <path d="M20 54 L30 54 L30 34" strokeWidth="7" />
      </g>
    </svg>
  )
}

function Fence({ green }: { green: boolean }) {
  const color = green ? '#04251a' : '#1e0616'
  return (
    <svg aria-hidden="true" height="100%" viewBox="0 0 90 40">
      <g fill={color}>
        <rect height="36" width="6" x="4" y="4" />
        <rect height="40" width="6" x="42" y="0" />
        <rect height="34" width="6" x="80" y="6" />
      </g>
      <g fill="none" stroke={color} strokeWidth="2.5">
        <path d="M6 14 L45 10 L83 16" />
        <path d="M6 26 L45 22 L83 28" />
      </g>
    </svg>
  )
}

function Tumbleweed() {
  return (
    <svg
      aria-hidden="true"
      className="animate-duel-roll"
      height="100%"
      style={{ transformOrigin: '50% 50%' }}
      viewBox="0 0 40 40"
    >
      <g fill="none" stroke="#2a0d18" strokeLinecap="round" strokeWidth="2.5">
        <circle cx="20" cy="20" r="16" />
        <path d="M6 12 L34 26 M6 28 L34 14 M20 4 L20 36 M4 20 L36 20" />
      </g>
    </svg>
  )
}
