import type { ReactNode } from 'react'
import { BULLET_TRACK_INSET, type ShotTarget } from '@/duel/domain/duel'
import type { ArenaPhase, Fighter } from '@/duel/domain/fighter'
import { Bullet, Clash, FoulDust, ImpactFlash, Taunt } from './Arena/effects'
import { Headline } from './Arena/lines'
import { TimeTag } from './Arena/resultLines'
import { Plate, SignalLamp } from './Arena/SignalLamp'
import { Wasteland } from './Arena/scenery'
import { Gunslinger } from './Gunslinger'

/*
 * 결투장 합성 — 배경(scenery)·신호등(SignalLamp)·연출(effects)·안내선(lines)을
 * phase에 따라 조립한다. 조각들은 Arena/ 아래에 성격별로 산다(DESIGN 원칙 7,
 * 915줄이던 것을 2026-08-18에 갈랐다).
 */

interface ArenaProps {
  phase: ArenaPhase
  round: number
  maxHp: number
  maxFouls: number
  left: Fighter
  right: Fighter
  leftShot: ShotTarget | null
  rightShot: ShotTarget | null
  leftMiss: boolean
  rightMiss: boolean
  miss: { side: 1 | 2; taunt: string } | null
  clash: boolean
  flightMs: number
  impactDelayMs: number
  winner: 0 | 1 | 2
  tie: boolean
  foulSide: 0 | 1 | 2
  selfShot: boolean
  ko: boolean
  pending: boolean
  hint: string
  actLabel: string
  fxKey: number
  children?: ReactNode
}

export function Arena({
  phase,
  round,
  maxHp,
  maxFouls,
  left,
  right,
  leftShot,
  rightShot,
  leftMiss,
  rightMiss,
  miss,
  clash,
  flightMs,
  impactDelayMs,
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
  const shots = leftShot !== null || rightShot !== null

  return (
    <div
      className={`relative w-full flex-1 overflow-hidden ${shots ? 'animate-duel-shake' : ''}`}
      key={`arena-${fxKey}`}
      style={{
        ['--gs-h' as string]: 'clamp(112px, 25vh, 208px)',
        ...(shots && { animationDelay: `${impactDelayMs}ms` }),
      }}
    >
      <Wasteland phase={phase} />

      <SignalLamp phase={phase} round={round} />

      <div className="absolute" style={{ left: 12, top: 62 }}>
        <Plate align="left" fighter={left} maxFouls={maxFouls} maxHp={maxHp} />
      </div>
      <div className="absolute" style={{ right: 12, top: 62 }}>
        <Plate align="right" fighter={right} maxFouls={maxFouls} maxHp={maxHp} />
      </div>

      <div
        className="absolute"
        style={{ bottom: '28%', left: '17%', transform: 'translateX(-50%)' }}
      >
        <Gunslinger
          fired={leftShot !== null}
          height="var(--gs-h)"
          outfit={left.outfit}
          pose={left.pose}
        />
      </div>
      <div
        className="absolute"
        style={{ bottom: '28%', right: '17%', transform: 'translateX(50%)' }}
      >
        <Gunslinger
          fired={rightShot !== null}
          flip
          height="var(--gs-h)"
          outfit={right.outfit}
          pose={right.pose}
        />
      </div>

      {(leftShot === 'opponent' || rightShot === 'opponent') && (
        <div
          className="pointer-events-none absolute"
          style={{
            bottom: 'calc(28% + var(--gs-h) * 0.5)',
            height: 0,
            left: `${BULLET_TRACK_INSET * 100}%`,
            right: `${BULLET_TRACK_INSET * 100}%`,
          }}
        >
          {leftShot === 'opponent' && (
            <Bullet
              clash={clash}
              color={left.outfit.rim}
              dir="r"
              flightMs={flightMs}
              miss={leftMiss}
            />
          )}
          {rightShot === 'opponent' && (
            <Bullet
              clash={clash}
              color={right.outfit.rim}
              dir="l"
              flightMs={flightMs}
              miss={rightMiss}
            />
          )}
          {clash && <Clash delayMs={Math.round(flightMs * 0.42)} />}
        </div>
      )}
      {leftShot === 'ground' && <FoulDust delayMs={flightMs} selfShot={selfShot} side={1} />}
      {rightShot === 'ground' && <FoulDust delayMs={flightMs} selfShot={selfShot} side={2} />}
      {settled && !tie && winner !== 0 && <ImpactFlash delayMs={impactDelayMs} winner={winner} />}
      {miss && <Taunt delayMs={impactDelayMs} side={miss.side} taunt={miss.taunt} />}

      <Headline
        actLabel={actLabel}
        landMs={impactDelayMs}
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

      {phase === 'result' && (
        <>
          <TimeTag landMs={impactDelayMs} ms={left.ms} side="left" tie={tie} won={winner === 1} />
          <TimeTag landMs={impactDelayMs} ms={right.ms} side="right" tie={tie} won={winner === 2} />
        </>
      )}

      {children}
    </div>
  )
}
