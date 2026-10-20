/**
 * 족보 콜아웃 오디오 변환의 상수.
 *
 * 값의 근거는 [`voiceDsp.mjs`](./voiceDsp.mjs)의 각 사용처 주석에 있다. 여기 모아 둔
 * 이유는 조정할 때 **숫자만** 보고 싶기 때문이다.
 */

/**
 * 슬러그 → 콜아웃이 화면에 떠 있는 시간(ms).
 * `RollResultCallout.tsx`의 `tierByHand` × `durationMsByTier`가 원본이다 —
 * 저쪽을 조정하면 여기도 같이 맞춰야 목소리가 텍스트보다 오래 남지 않는다.
 */
export const CALLOUT_MS = {
  yacht: 2400,
  'large-straight': 1800,
  'small-straight': 1400,
  'full-house': 1400,
  'four-of-a-kind': 1400,
}
export const SLUGS = Object.keys(CALLOUT_MS)
/** 목소리가 텍스트보다 먼저 끝나야 한다. 이만큼 여유를 남겨 경고 기준으로 쓴다. */
export const CALLOUT_MARGIN_MS = 200

export const SAMPLE_RATE = 22050

/**
 * 정규화 목표 — 피크가 아니라 **체감 크기**(가장 큰 50ms 창의 RMS)를 맞춘다.
 *
 * 피크로 맞추면 뾰족한 순간 하나가 전체를 눌러버린다. "라지 스트레이트" 녹음은 피크가 다른
 * 파일과 같은데도 체감이 6dB 작았다 — 120ms 지점 파열음 하나 때문이었다(0.5를 넘는 샘플이
 * 전체의 0.16%). 그 0.16%는 리미터로 눕히고 나머지를 올리는 게 맞다.
 */
export const TARGET_LOUDNESS = 0.4
/** 창 RMS를 재는 창 길이. 음절 하나가 들어갈 만큼은 돼야 체감 크기에 가깝다. */
export const LOUDNESS_WINDOW_MS = 50
/** 조용한 녹음을 무한정 키우면 잡음만 커진다. 이 배수를 넘으면 경고하고 여기서 멈춘다. */
export const MAX_GAIN = 12

/** 리미터 — 이 값 위부터 완만하게 눕히고, 절대 CEILING을 넘기지 않는다. */
export const LIMIT_KNEE = 0.7
export const LIMIT_CEILING = 0.95

/**
 * 말소리 구간 검출 파라미터. 10ms 창의 RMS를 가장 큰 창과 비교한 비율로 쓴다.
 *
 * 창 피크를 절대 기준과 비교하면 트림이 거의 안 된다 — 폰 녹음에는 녹음 버튼 탭·숨·방 잡음이
 * 말소리의 5~12% 세기로 앞뒤에 붙어 있어서, 그 잡음까지 "소리 있는 구간"으로 잡힌다.
 * 그래서 (1) 확실한 말소리(ONSET)만 먼저 찾고 (2) 음절 사이 공백(GAP)만 이어 붙이고
 * (3) 자음 꼬리만큼만(EDGE_MAX) 밖으로 넓힌다.
 */
export const ONSET_RATIO = 0.15
export const EDGE_RATIO = 0.05
export const WINDOW_MS = 10
/** 이보다 짧은 공백은 한 단어 안의 음절 간격으로 보고 이어 붙인다("스몰 스트레이트"의 중간 쉼). */
export const GAP_MS = 250
/** 말소리 양끝을 EDGE 기준으로 넓힐 수 있는 최대 길이. 이 이상은 잡음으로 본다. */
export const EDGE_MAX_MS = 80
/** 검출 구간 밖에 이 세기 이상이 남아 있으면 "잘렸을 수도 있다"고 알린다. */
export const LEFTOVER_RATIO = 0.15

export const HEAD_KEEP_MS = 20
export const TAIL_KEEP_MS = 60
/** 페이드아웃은 길게 — 뒤에 남긴 TAIL_KEEP 구간의 잡음까지 같이 죽인다. */
export const FADE_IN_MS = 5
export const FADE_OUT_MS = 40

/**
 * 족보별 에코. 원음 뒤로 `delayMs`마다 `decay`배씩 작아지는 복사본을 `repeats`개 겹치는
 * 멀티탭 딜레이다. 꼬리가 `delayMs × repeats`만큼 붙으므로 콜아웃 표시 시간을 넘기지 않게
 * 잡아야 한다 — 넘기면 길이 검사가 경고한다.
 *
 * 값은 **등급을 따라간다** — 화면 느낌표가 등급만큼 붙는 것과 같은 이유로, 등급이 높을수록
 * 꼬리를 길고 진하게 준다. 상한은 콜아웃 표시 시간이 정한다: 창이 1.4초뿐인 1등급에
 * 요트와 같은 540ms 꼬리를 붙이면 텍스트가 사라진 뒤에도 소리가 남는다.
 *
 *   등급 3 요트(2.4초)         180ms x3 decay 0.50 → 꼬리 540ms
 *   등급 2 라지 스트레이트(1.8초) 150ms x3 decay 0.45 → 꼬리 450ms
 *   등급 1 나머지(1.4초)        120ms x2 decay 0.40 → 꼬리 240ms
 */
export const ECHO = {
  yacht: { delayMs: 180, repeats: 3, decay: 0.5 },
  'large-straight': { delayMs: 150, repeats: 3, decay: 0.45 },
  'small-straight': { delayMs: 120, repeats: 2, decay: 0.4 },
  'full-house': { delayMs: 120, repeats: 2, decay: 0.4 },
  'four-of-a-kind': { delayMs: 120, repeats: 2, decay: 0.4 },
}
