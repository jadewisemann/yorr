import { lazy } from 'react'
import type { GameCode } from '@/games'

/**
 * 게임 코드별 화면. 모듈은 게임별 수직 슬라이스라 여기서만 지연 로드한다 —
 * 한 게임의 번들이 다른 게임 화면을 끌고 오지 않게.
 */
const moduleScreens = {
  DAVINCI_CODE: {
    Game: lazy(() =>
      import('@/davinci/screens/DavinciGame').then((module) => ({ default: module.DavinciGame })),
    ),
    Result: lazy(() =>
      import('@/davinci/screens/DavinciResult').then((module) => ({
        default: module.DavinciResult,
      })),
    ),
  },
  DUEL: {
    Game: lazy(() =>
      import('@/duel/screens/DuelGame').then((module) => ({ default: module.DuelGame })),
    ),
    Result: lazy(() =>
      import('@/duel/screens/DuelResult').then((module) => ({ default: module.DuelResult })),
    ),
  },
  PING_PONG: {
    Game: lazy(() =>
      import('@/pingpong/screens/PingPongGame').then((module) => ({
        default: module.PingPongGame,
      })),
    ),
    Result: lazy(() =>
      import('@/pingpong/screens/PingPongResult').then((module) => ({
        default: module.PingPongResult,
      })),
    ),
  },
} as const

/** 야추는 번들에 바로 들어 있어 게임 코드가 없거나 야추일 때 쓰인다. */
export type GameScreens = (typeof moduleScreens)[keyof typeof moduleScreens]

export function screensOf(gameCode: GameCode | undefined): GameScreens | null {
  return gameCode !== undefined && gameCode in moduleScreens
    ? moduleScreens[gameCode as keyof typeof moduleScreens]
    : null
}
