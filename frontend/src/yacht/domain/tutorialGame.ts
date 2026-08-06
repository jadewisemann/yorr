import type { DiceSet } from '@/realtime/wsEvents'
import { createLocalSession, createLocalSnapshot, createLocalYachtClient } from './localGame'

/**
 * 연습 모드는 방도 상대도 없다. 실제 게임 화면(GamePlay)을 그대로 띄우되 서버 자리에
 * 이 모듈이 들어간다 — 화면을 따로 만들면 "연습에서 본 것"과 "실전에서 만나는 것"이
 * 갈라지고, 그 차이가 곧 튜토리얼이 못 가르친 부분이 된다.
 *
 * 실서버 계약(dice.broadcast · dice.hold_changed · score.update)은 공용 로컬 서버
 * (localGame)가 지킨다. 연습 모드가 정하는 것은 굴림 대본 하나뿐이다.
 */
export const TUTORIAL_ROOM_ID = 'tutorial'
export const TUTORIAL_PLAYER_ID = 'tutorial-player'

export const tutorialSession = createLocalSession({
  playerId: TUTORIAL_PLAYER_ID,
  roomCode: 'TUTORIAL',
  roomId: TUTORIAL_ROOM_ID,
})

export function createTutorialSnapshot() {
  return createLocalSnapshot({ playerId: TUTORIAL_PLAYER_ID, roomId: TUTORIAL_ROOM_ID })
}

/**
 * 연습 굴림은 결과를 미리 정해 둔다. 주사위 눈은 어차피 서버가 정하므로 연습에서는 가르치기
 * 좋은 쪽으로 고른다 — 무작위로 두면 "6 두 개를 킵해 보세요" 같은 구체적인 안내를 할 수 없고,
 * 운이 나쁘면 아무것도 배우지 못한 채 한 턴이 끝난다.
 *
 * 6이 두 개 → 세 개 → 네 개로 불어나므로, 킵이 왜 이득인지가 숫자로 그대로 보인다.
 */
const SCRIPTED_ROLLS: DiceSet[] = [
  [6, 6, 2, 3, 5],
  [6, 6, 6, 4, 1],
  [6, 6, 6, 6, 2],
]

/**
 * 킵한 자리는 그대로 두고 나머지만 대본 값으로 채운다. 사용자가 안내와 다른 주사위를 킵해도
 * 흐름이 깨지지 않는다 — 대본이 뒤로 갈수록 6이 많아지므로 어느 쪽을 킵하든 6은 늘어난다.
 */
function scriptedRoll(held: readonly boolean[], previous: DiceSet | null, rollCount: number) {
  const scripted = SCRIPTED_ROLLS[Math.min(rollCount, SCRIPTED_ROLLS.length) - 1]
  if (!scripted) throw new Error(`연습 굴림 ${rollCount}의 대본이 없습니다`)
  return Array.from({ length: 5 }, (_, index) =>
    held[index] && previous ? previous[index] : scripted[index],
  ) as unknown as DiceSet
}

/** 연습판 한 벌. 화면을 나갔다 들어오면 새로 만들어 처음부터 시작한다. */
export function createTutorialClient() {
  return createLocalYachtClient({
    playerId: TUTORIAL_PLAYER_ID,
    roomId: TUTORIAL_ROOM_ID,
    // 연습은 한 턴짜리다 — 라운드를 넘기지 않는다(rounds 없음).
    roll: ({ held, previous, rollCount }) => scriptedRoll(held, previous, rollCount),
  })
}
