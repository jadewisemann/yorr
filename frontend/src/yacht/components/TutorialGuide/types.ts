import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'

export type GuideStep =
  | 'greet'
  | 'roll'
  | 'keep'
  | 'reroll'
  | 'keepAgain'
  | 'askLastRoll'
  | 'motion'
  | 'lastRoll'
  | 'record'
  | 'categories'
  | 'done'

export interface Lesson {
  title: string
  body: string
  action?: string
  secondary?: { label: string; step: GuideStep }
  hand?: { category?: YachtCategory; index: number; total: number; score?: number | undefined }
}

export interface LessonContext {
  sixes: number
  sixesScore: number
  keptSixes: number
  keptOther: number
  handIndex: number
  motionNoticeVisible: boolean
  candidates: CategoryScores
  wide: boolean
}

export interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}
