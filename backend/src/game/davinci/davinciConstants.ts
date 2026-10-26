import { DAVINCI_JOKER, type DavinciTileColor } from './davinciState.js'

/**
 * 다빈치 코드의 상수와 타일 순서.
 *
 * 왜 분리했나: 덱 구성·인원수별 패 크기·단계별 제한 시간은 규칙 함수들이 **읽기만**
 * 하는 값이다. 상태 전이 코드와 섞여 있으면 "이 숫자가 어디서 왔나"를 찾느라
 * 400줄을 훑어야 한다.
 */

/** 색깔마다 0~11 열두 장 + 조커 한 장 = 스물여섯 장. */
export const DAVINCI_MAX_NUMBER = 11
export const DAVINCI_DECK_SIZE = 26

export const DAVINCI_MIN_PLAYERS = 2
export const DAVINCI_MAX_PLAYERS = 4

/** 4인이면 세 장, 2~3인이면 네 장 — 정식 규칙 그대로다. */
export const HAND_SIZE_FEW = 4
export const HAND_SIZE_MANY = 3
export const MANY_PLAYERS = 4

/** 각 단계의 제한 시간(ms). 추측이 가장 길다 — 유일하게 생각할 것이 있는 단계다. */
export const GUESS_MILLIS = 30_000
export const DECIDE_MILLIS = 15_000
export const PLACE_MILLIS = 15_000

/** 섞기 전의 표준 스물여섯 장. 이 순서 자체는 판에 쓰이지 않는다(항상 섞어서 쓴다). */
export const DAVINCI_TILES: readonly { color: DavinciTileColor; number: number }[] = [
  ...(['BLACK', 'WHITE'] as const).flatMap((color) => [
    ...Array.from({ length: DAVINCI_MAX_NUMBER + 1 }, (_, number) => ({ color, number })),
    { color, number: DAVINCI_JOKER },
  ]),
]
