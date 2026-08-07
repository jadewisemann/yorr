import { MAX_ROLLS } from '@/yacht/domain/yachtGame'
import type { GuideStep } from './types'

interface PlaySignals {
  keptSixes: number
  motionNoticeVisible: boolean
  rolled: boolean
  rollCount: number
  rolling: boolean
  sixesOnTray: number
  submitted: boolean
}

export function stepFromPlay(step: GuideStep, play: PlaySignals): GuideStep | null {
  if (play.rolling) return null
  if (step === 'done' || step === 'categories') return null
  if (play.submitted) return 'categories'
  if (step === 'motion' || step === 'lastRoll') {
    return play.rollCount >= MAX_ROLLS ? 'record' : null
  }
  return PLAY_ADVANCE[step]?.(play) ?? null
}

const PLAY_ADVANCE: Partial<Record<GuideStep, (play: PlaySignals) => GuideStep | null>> = {
  greet: (play) => (play.rolled ? 'keep' : null),
  roll: (play) => (play.rolled ? 'keep' : null),
  keep: (play) => (allSixesKept(play) ? 'reroll' : null),
  reroll: (play) => (play.rollCount >= 2 ? 'keepAgain' : null),
  keepAgain: (play) => (allSixesKept(play) ? afterKeepAgain(play) : null),
}

function allSixesKept(play: PlaySignals) {
  return play.keptSixes >= play.sixesOnTray
}

export function afterKeepAgain(play: PlaySignals): GuideStep {
  return play.rollCount >= MAX_ROLLS ? 'record' : 'askLastRoll'
}

export function nextOf(step: GuideStep, motionAvailable: boolean): GuideStep {
  if (step === 'greet') return 'roll'
  if (step === 'askLastRoll') return motionAvailable ? 'motion' : 'lastRoll'
  if (step === 'motion') return 'lastRoll'
  if (step === 'categories') return 'done'
  return step
}
