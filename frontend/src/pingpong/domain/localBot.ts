import type { LocalPingPongDifficulty } from './localGame'

/**
 * 로컬 탁구의 **상대(봇) 성향 표**. 난이도별 실패 확률·폴트 허용 폭·스매시 반격률.
 *
 * 게임 루프(`localGame.ts`)와 스윙 판정(`localSwing.ts`)이 공유하므로 독립 파일이다.
 * 값을 조정할 때 두 곳을 함께 보지 않아도 되게 한다.
 */
export interface BotSkill {
  band: number
  missNormal: number
  missSmash: number
  ramp: number
  rampCap: number
  smashBack: number
}

export const BOT: Record<LocalPingPongDifficulty, BotSkill> = {
  easy: {
    band: 0.02,
    missNormal: 0.11,
    missSmash: 0.46,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.05,
  },
  normal: {
    band: 0.04,
    missNormal: 0.07,
    missSmash: 0.2,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.3,
  },
  hard: {
    band: 0.05,
    missNormal: 0.02,
    missSmash: 0.14,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.3,
  },
}
