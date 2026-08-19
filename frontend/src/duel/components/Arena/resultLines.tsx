import { isClean, msLabel } from '@/duel/domain/duel'
import type { Fighter } from '@/duel/domain/fighter'
import { LABEL_MONO } from './label'

/* 결과 안내선 — 반칙·무승부·명중. TimeTag는 Arena 본체도 직접 쓴다. */

export const WRAP =
  'pointer-events-none absolute inset-x-0 flex flex-col items-center px-4 text-center'

export function FoulLine({
  landMs,
  maxFouls,
  selfShot,
  who,
}: {
  landMs: number
  maxFouls: number
  selfShot: boolean
  who: Fighter
}) {
  const color = selfShot ? 'var(--ds-duel-danger)' : 'var(--ds-duel-gold)'
  return (
    <div className={WRAP} style={{ top: '24%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${landMs}ms`,
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
        style={{ animationDelay: `${landMs + 90}ms`, color: 'rgb(255 232 205 / 90%)' }}
      >
        {selfShot
          ? `${who.name} — 경고 ${maxFouls}/${maxFouls} · 결투에서 진다`
          : `${who.name} — 신호 전에 뽑았다 · 경고 ${who.fouls}/${maxFouls}`}
      </div>
      <div
        className={`animate-duel-slam mt-1 ${LABEL_MONO}`}
        style={{ animationDelay: `${landMs + 150}ms`, color: 'rgb(255 220 190 / 60%)' }}
      >
        {selfShot ? '실격' : '라운드 무효 · 다음 부정출발은 패배'}
      </div>
    </div>
  )
}

export function TieLine({
  landMs,
  left,
  right,
}: {
  landMs: number
  left: Fighter
  right: Fighter
}) {
  return (
    <div className={WRAP} style={{ top: '25%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${landMs}ms`,
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
        style={{ animationDelay: `${landMs + 90}ms`, color: 'rgb(253 230 138 / 85%)' }}
      >
        {isClean(left.ms) && isClean(right.ms)
          ? `1ms 까지 똑같다 — 둘 다 ${left.ms}ms`
          : '둘 다 놓쳤다 — 다시 간다'}
      </div>
    </div>
  )
}

export function ShotLine({
  ko,
  landMs,
  shooter,
}: {
  ko: boolean
  landMs: number
  shooter: Fighter
}) {
  return (
    <div className={WRAP} style={{ top: '24%' }}>
      <div
        className="animate-duel-slam font-black"
        style={{
          animationDelay: `${landMs}ms`,
          color: ko ? 'var(--ds-duel-danger)' : '#fff1d6',
          fontSize: ko ? 'clamp(44px, 13vw, 92px)' : 'clamp(34px, 10vw, 70px)',
          lineHeight: 0.95,
          textShadow: `0 0 30px ${shooter.outfit.scarf}, 0 4px 0 rgb(0 0 0 / 50%)`,
        }}
      >
        {ko ? 'K.O.' : 'HIT!'}
      </div>
      <div
        className="animate-duel-slam mt-1.5 text-sm font-bold"
        style={{ animationDelay: `${landMs + 90}ms`, color: 'rgb(255 232 205 / 88%)' }}
      >
        {shooter.name} — 먼저 뽑았다
      </div>
    </div>
  )
}

export function TimeTag({
  landMs,
  ms,
  side,
  tie,
  won,
}: {
  landMs: number
  ms: number | null
  side: 'left' | 'right'
  tie: boolean
  won: boolean
}) {
  if (ms == null) return null
  const good = isClean(ms)
  const color = tie
    ? '#fde68a'
    : won
      ? 'var(--ds-duel-positive)'
      : good
        ? 'var(--ds-duel-danger)'
        : '#f87171'
  return (
    <div
      className="animate-duel-slam pointer-events-none absolute"
      style={{
        [side]: '17%',
        animationDelay: `${landMs}ms`,
        bottom: 'calc(28% - 30px)',
        transform: `translateX(${side === 'left' ? '-50%' : '50%'})`,
      }}
    >
      <span
        className="rounded-chip px-2 py-0.5 text-xs font-black whitespace-nowrap tabular-nums"
        style={{ background: 'rgb(8 3 5 / 72%)', border: `1px solid ${color}55`, color }}
      >
        {msLabel(ms)}
      </span>
    </div>
  )
}
