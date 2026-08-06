import { MAX_ROLLS } from '@/yacht/domain/yachtGame'
import type { GuideStep } from './types'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/** 플레이 신호. 안내가 따로 세지 않고 GamePlay가 넘겨준 값에서만 읽는다. */
interface PlaySignals {
  keptSixes: number
  motionNoticeVisible: boolean
  rolled: boolean
  rollCount: number
  rolling: boolean
  sixesOnTray: number
  submitted: boolean
}

/**
 * 플레이 신호를 보고 지금 서 있어야 할 단계. null이면 이 단계는 플레이로 넘어가지 않는다는
 * 뜻이고(버튼이 옮긴다), 그대로 머문다.
 *
 * 안내보다 빨리 플레이해도 억지로 되돌리지 않고 앞 단계를 건너뛴다. 인사 중에 이미 굴려
 * 버린 사람도 여기서 따라잡는다 — 인사를 눌러야만 넘어가면 먼저 굴린 사람은 남은 안내를
 * 통째로 놓친다.
 */
export function stepFromPlay(step: GuideStep, play: PlaySignals): GuideStep | null {
  /*
   * 주사위가 날아가는 동안에는 어느 단계도 움직이지 않는다. rollCount는 굴림이 시작될 때
   * 올라가고 dice는 애니메이션이 끝나야 바뀌므로, 이 사이에 판단하면 "새 굴림 수 + 옛
   * 주사위"를 읽는다 — 두 번째 던지기가 날아가는 중에 옛 킵(2/2)이 새 선택을 끝낸 것으로
   * 보여 선택 단계를 건너뛰고 던지기 물음이 먼저 뜨던 버그가 그것이다.
   */
  if (play.rolling) return null
  // 족보 설명과 마무리는 버튼으로만 넘어간다 — 읽는 중에 판이 바뀌어도 끌려가면 안 된다.
  if (step === 'done' || step === 'categories') return null
  /*
   * 기록을 마치면 족보 둘러보기로 넘어간다. 먼저 한 칸을 직접 적어 본 뒤에 나머지를 배우는
   * 순서다 — 규칙 열두 개를 먼저 읽히면 무엇을 위한 규칙인지 모르는 채로 읽는다.
   */
  if (play.submitted) return 'categories'
  // 마지막 굴림을 쓰는 두 단계는 굴림 수만 본다.
  if (step === 'motion' || step === 'lastRoll') {
    return play.rollCount >= MAX_ROLLS ? 'record' : null
  }
  return PLAY_ADVANCE[step]?.(play) ?? null
}

/**
 * 단계별로 "무엇이 충족되면 어디로 가는가". 표로 두면 안내 순서가 한눈에 읽힌다 —
 * if 사슬로 늘어놓으면 순서가 코드 줄 순서에 숨는다.
 *
 * 여기 없는 단계(askLastRoll · motion · lastRoll · record · categories · done)는 위에서
 * 따로 다루거나 버튼으로만 넘어간다.
 */
const PLAY_ADVANCE: Partial<Record<GuideStep, (play: PlaySignals) => GuideStep | null>> = {
  // 인사 중에 이미 굴려 버린 사람도 여기서 따라잡는다.
  greet: (play) => (play.rolled ? 'keep' : null),
  roll: (play) => (play.rolled ? 'keep' : null),
  // 6이 두 개인데 하나만 킵하고 넘어가면 "같은 눈을 모은다"를 절반만 해본 셈이다.
  keep: (play) => (allSixesKept(play) ? 'reroll' : null),
  reroll: (play) => (play.rollCount >= 2 ? 'keepAgain' : null),
  // 두 번 고르고 나면 남은 한 번을 쓴다 — 센서가 있으면 흔들어서, 없으면 그냥 한 번 더.
  keepAgain: (play) => (allSixesKept(play) ? afterKeepAgain(play) : null),
}

function allSixesKept(play: PlaySignals) {
  return play.keptSixes >= play.sixesOnTray
}

/**
 * 두 번째 선택 뒤에 갈 곳. 안내보다 빨리 세 번을 다 굴려 버렸으면 굴릴 것이 없으니 바로
 * 기록으로 간다 — 남지도 않은 굴림을 어떻게 던질지 물으면 답할 방법이 없다.
 */
export function afterKeepAgain(play: PlaySignals): GuideStep {
  return play.rollCount >= MAX_ROLLS ? 'record' : 'askLastRoll'
}

/** 버튼으로 넘기는 단계의 다음 칸. 나머지는 플레이 신호가 옮긴다. */
export function nextOf(step: GuideStep, motionAvailable: boolean): GuideStep {
  if (step === 'greet') return 'roll'
  // 센서가 없는 기기에서는 물음이 한 갈래뿐이라 곧장 버튼 굴림으로 간다.
  if (step === 'askLastRoll') return motionAvailable ? 'motion' : 'lastRoll'
  // 흔들기를 마다한 사람도 마지막 굴림은 해야 한다 — 버튼으로 굴리는 같은 자리로 보낸다.
  if (step === 'motion') return 'lastRoll'
  // 족보를 다 둘러봤으면 마무리다.
  if (step === 'categories') return 'done'
  return step
}
