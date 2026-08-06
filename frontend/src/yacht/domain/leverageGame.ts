import { type HeldDice, nextRollSeed, rollDice } from '@/yacht/domain/dice'
import { leverageMultiplier, pickLeverageCategory } from '@/yacht/domain/leverage'
import { scoreCategory, YACHT_CATEGORIES } from '@/yacht/domain/scoring'
import { createLocalSession, createLocalSnapshot, createLocalYachtClient } from './localGame'

/**
 * 레버리지 다이스 모드(S15P11A406-208)의 로컬 판. 규칙은 도메인(domain/leverage.ts)에 있고,
 * 여기는 그 규칙을 공용 로컬 서버(localGame)에 꽂는 자리다.
 *
 * 온라인 멀티는 아직이다 — 점수는 서버도 계산하므로(realtime/wsEvents.ts 주석) 백엔드가
 * 2배 규칙을 알기 전까지 이 모드는 로컬 전용이다.
 */
export const LEVERAGE_ROOM_ID = 'leverage'
export const LEVERAGE_PLAYER_ID = 'leverage-player'
/** 12족보 = 12라운드. 칸이 다 차면 판이 끝난다. */
export const LEVERAGE_ROUNDS = YACHT_CATEGORIES.length

export const leverageSession = createLocalSession({
  playerId: LEVERAGE_PLAYER_ID,
  roomCode: 'LEVERAGE',
  roomId: LEVERAGE_ROOM_ID,
})

export function createLeverageSnapshot() {
  return createLocalSnapshot({ playerId: LEVERAGE_PLAYER_ID, roomId: LEVERAGE_ROOM_ID })
}

/**
 * 레버리지 한 판. `seed`가 판 전체의 난수 원본이다 — 화면도 같은 시드로 레버리지 족보를
 * 계산하므로(LeveragePage), 미리보기에 뜬 2배 칸과 실제로 기록되는 2배 칸이 어긋나지 않는다.
 */
export function createLeverageClient(seed: number) {
  let rollSeed = seed

  return createLocalYachtClient({
    playerId: LEVERAGE_PLAYER_ID,
    roomId: LEVERAGE_ROOM_ID,
    rounds: LEVERAGE_ROUNDS,
    roll: ({ held, previous }) => {
      rollSeed = nextRollSeed(rollSeed)
      return rollDice(rollSeed, held as HeldDice, previous)
    },
    score: ({ category, dice, roundNumber, used }) =>
      scoreCategory(dice, category) *
      leverageMultiplier(category, pickLeverageCategory(seed, roundNumber, used)),
  })
}
