const REGULATION_TABLE_LEN = 2.74
export const TABLE_LEN = REGULATION_TABLE_LEN * 1.28
export const TABLE_W = 1.525
export const TABLE_H = 0.76
export const TABLE_THICK = 0.05
export const NET_H = 0.1525
export const NET_OVERHANG = 0.1525
export const BALL_R = 0.02

export const FAR_Z = -TABLE_LEN / 2
export const NEAR_Z = TABLE_LEN / 2

export const WIN_SCORE = 11
export const IDEAL1 = 0.9
export const W1_LO = 0.72
export const W1_HI = 1.06
export const MISS1 = 1.1
export const IDEAL2 = 1 - IDEAL1
export const W2_LO = 1 - W1_HI
export const W2_HI = 1 - W1_LO
export const MISS2 = 1 - MISS1
export const PERFECT_D = 0.06
export const GOOD_D = 0.1

export const FAULT_BAND = 0.04

export const NORMAL_SPEED = 1.0
export const SMASH_SPEED = 1.95
export const WEAK_SPEED = 0.82

export function posToZ(pos: number): number {
  return FAR_Z + (NEAR_Z - FAR_Z) * pos
}

export function xToWorld(x: number): number {
  return (x - 0.5) * TABLE_W
}

const NET_CROSS_PROG = 0.5

const LAUNCH = 0.12
const ARRIVE = 0.13

export interface Flight {
  bounceAt: number
  netClear: number
  reboundCtrl: number
}

const NORMAL_FLIGHT: Flight = { bounceAt: 0.7, netClear: 0.25, reboundCtrl: 0.2 }
const SMASH_FLIGHT: Flight = { bounceAt: 0.62, netClear: 0.175, reboundCtrl: 0.13 }

export function flightOf(smash: boolean): Flight {
  return smash ? SMASH_FLIGHT : NORMAL_FLIGHT
}

function arcA(f: Flight): { a: number; b: number } {
  const B = f.bounceAt
  const d = f.netClear - LAUNCH
  const b = (-LAUNCH - 4 * B * B * d) / (B - 2 * B * B)
  const a = 4 * d - 2 * b
  return { a, b }
}
const A_NORMAL = arcA(NORMAL_FLIGHT)
const A_SMASH = arcA(SMASH_FLIGHT)

export type Fault = 'out' | 'net' | null

export const NET_HIT_PROG = NET_CROSS_PROG
export const OUT_END_PROG = 1.5

const OUT_A = -2.585
const OUT_B = 1.705
const NET_A = -0.218
const NET_B = 0.198

function ballLift(prog: number, smash: boolean, fault: Fault = null, from = 0): number {
  return fault ? faultLift(prog, fault, from) : rallyLift(prog, smash)
}

function faultLift(prog: number, fault: Exclude<Fault, null>, from: number): number {
  const end = fault === 'out' ? OUT_END_PROG : NET_HIT_PROG
  const span = end - from
  const t = span <= 0 ? 1 : (prog - from) / span
  const u = clampUnit(t)
  return fault === 'out' ? OUT_A * u * u + OUT_B * u + LAUNCH : NET_A * u * u + NET_B * u + LAUNCH
}

function rallyLift(prog: number, smash: boolean): number {
  const f = flightOf(smash)
  const p = clampUnit(prog)
  if (p <= f.bounceAt) {
    const { a, b } = smash ? A_SMASH : A_NORMAL
    const h = a * p * p + b * p + LAUNCH
    return h < 0 ? 0 : h
  }
  const span = 1 - f.bounceAt
  const t = span <= 0 ? 1 : (p - f.bounceAt) / span
  const u = 1 - t
  return 2 * t * u * f.reboundCtrl + t * t * ARRIVE
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function ballY(prog: number, smash: boolean, fault: Fault = null, from = 0): number {
  return TABLE_H + ballLift(prog, smash, fault, from)
}

export function flightProgress(pos: number, dir: number, fault: Fault = null): number {
  const v = dir > 0 ? pos : 1 - pos
  const hi = fault === 'out' ? OUT_END_PROG : 1
  return v < 0 ? 0 : v > hi ? hi : v
}

const EARLY_MARGIN = IDEAL1 - W1_LO // 0.18
const LATE_MARGIN = W1_HI - IDEAL1 // 0.16

export function faultOf(d: number, early: boolean, band: number = FAULT_BAND): Fault {
  const limit = (early ? EARLY_MARGIN : LATE_MARGIN) - band
  if (d <= limit) return null
  return early ? 'out' : 'net'
}

export function viewerDepth(pos: number, viewer: 1 | 2): number {
  return viewer === 1 ? pos : 1 - pos
}
